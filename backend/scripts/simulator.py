#!/usr/bin/env python3
"""Simulate Safelock devices over MQTT"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import getpass
import json
import os
import signal
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, cast
from urllib.parse import urlparse

import aiomqtt

BASE_TOPIC = "safelock/devices"
DEFAULT_CARD_UID = "AA:BB:CC:DD"
DEFAULT_DEVICES = "sl-0001,sl-0002"
DEFAULT_FIRMWARE = "0.1.0"
DEFAULT_HEARTBEAT_S = 30.0
DEFAULT_URL = "mqtt://127.0.0.1:1883"
RECONNECT_DELAY_S = 5.0
PIN_PENDING_TTL_S = 30.0

JsonObject = dict[str, Any]

HELP = """\
Commands:
  use <device_id>    Select the target device
  scan <UID>         Send an enrollment card scan
  pin <UID> <PIN>    Send a PIN entry event (after a grant with requires_pin)
  grant [UID]        Decide card access using the local access list
  deny [UID]         Send a denied access decision
  open               Simulate a remote unlock
  manual             Simulate a manual opening
  offline on|off     Simulate the backend being unavailable
  stale on|off       Force the access list to look too old
  acl                Print the local access list
  status             Republish the retained status
  help               Show this help
  quit               Exit
"""


@dataclass(frozen=True)
class Config:
    hostname: str
    port: int
    password: str
    devices: list[str]
    heartbeat_s: float
    interactive: bool


@dataclass
class DeviceState:
    online: bool = True
    firmware: str = DEFAULT_FIRMWARE
    acl_version: int = 0
    has_acl: bool = False
    stale: bool = False
    acl_received_at: float = 0.0
    requires_pin: bool = False
    locked: bool = False
    lock: str = "locked"
    unlock_ms: int = 3000
    offline_policy: str = "allow"
    stale_acl_hours: int = 72
    entries: list[JsonObject] = field(default_factory=list)
    pending_enrollment: str | None = None
    pending_enrollment_until: float = 0.0
    pending_pin_uid: str | None = None
    pending_pin_request_id: str | None = None
    pending_pin_until: float = 0.0


def envelope(device_id: str, data: JsonObject) -> JsonObject:
    return {
        "id": str(uuid.uuid4()),
        "ts": int(time.time()),
        "device_id": device_id,
        "data": data,
    }


def as_int(value: Any, default: int) -> int:
    return value if isinstance(value, int) else default


def as_str(value: Any, default: str) -> str:
    return value if isinstance(value, str) else default


def build_config(args: argparse.Namespace) -> Config:
    parsed = urlparse(str(args.url))
    if parsed.scheme != "mqtt" or parsed.hostname is None:
        raise SystemExit("Use an mqtt:// URL; the local broker has no TLS")

    heartbeat_s = float(args.heartbeat)
    if heartbeat_s <= 0:
        raise SystemExit("--heartbeat must be greater than zero")

    devices = [item.strip() for item in str(args.devices).split(",") if item.strip()]
    if not devices:
        raise SystemExit("At least one device ID is required")

    password = args.password
    if password is None:
        password = getpass.getpass("MQTT password: ") if sys.stdin.isatty() else ""

    return Config(
        hostname=parsed.hostname,
        port=parsed.port or 1883,
        password=str(password),
        devices=devices,
        heartbeat_s=heartbeat_s,
        interactive=not bool(args.no_interactive) and sys.stdin.isatty(),
    )


class SimulatedDevice:
    def __init__(self, device_id: str, config: Config) -> None:
        self.device_id = device_id
        self.config = config
        self.state = DeviceState()
        self.actions: asyncio.Queue[str] = asyncio.Queue()
        self._client: aiomqtt.Client | None = None
        self._relock_task: asyncio.Task[None] | None = None

    @property
    def base_topic(self) -> str:
        return f"{BASE_TOPIC}/{self.device_id}"

    @property
    def status_topic(self) -> str:
        return f"{self.base_topic}/status"

    @property
    def commands_topic(self) -> str:
        return f"{self.base_topic}/commands/#"

    async def run(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await self._run_connected(stop)
            except aiomqtt.MqttError as error:
                print(f"{self.device_id}: MQTT error: {error}", file=sys.stderr)
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), timeout=RECONNECT_DELAY_S)

    async def _run_connected(self, stop: asyncio.Event) -> None:
        client = self._build_client()
        self._client = client

        try:
            async with client:
                await self._publish_status()
                await client.subscribe(self.commands_topic, qos=1)
                print(
                    f"{self.device_id}: connected to "
                    f"{self.config.hostname}:{self.config.port}"
                )

                stop_task = asyncio.create_task(stop.wait())
                tasks = {
                    stop_task,
                    asyncio.create_task(self._heartbeat_loop(stop)),
                    asyncio.create_task(self._command_loop()),
                    asyncio.create_task(self._action_loop()),
                }

                try:
                    done, _ = await asyncio.wait(
                        tasks, return_when=asyncio.FIRST_COMPLETED
                    )
                    if stop_task in done:
                        await self._publish_status(online=False)
                    for task in done:
                        if task is not stop_task:
                            task.result()
                finally:
                    for task in tasks:
                        task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            self._client = None
            await self._cancel_relock()

    def _build_client(self) -> aiomqtt.Client:
        will_payload = json.dumps(
            envelope(self.device_id, self._status_data(online=False)),
            separators=(",", ":"),
        )
        return aiomqtt.Client(
            hostname=self.config.hostname,
            port=self.config.port,
            username=self.device_id,
            password=self.config.password,
            identifier=f"sim-{self.device_id}",
            will=aiomqtt.Will(
                topic=self.status_topic,
                payload=will_payload,
                qos=1,
                retain=True,
            ),
        )

    async def _heartbeat_loop(self, stop: asyncio.Event) -> None:
        started_at = time.monotonic()
        while not stop.is_set():
            if self.state.online:
                await self._publish(
                    "heartbeat",
                    {
                        "uptime_s": int(time.monotonic() - started_at),
                        "rssi": -58,
                        "rtc_valid": True,
                        "free_heap": 180000,
                    },
                    qos=0,
                )
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=self.config.heartbeat_s)

    async def _command_loop(self) -> None:
        client = self._require_client()
        async for message in client.messages:
            topic = str(message.topic)
            if not topic.startswith(f"{self.base_topic}/commands/"):
                continue
            if not self.state.online:
                print(f"{self.device_id}: offline, ignoring {topic}")
                continue

            try:
                payload = json.loads(message.payload)
            except json.JSONDecodeError, UnicodeDecodeError:
                print(f"{self.device_id}: invalid JSON command", file=sys.stderr)
                continue
            if not isinstance(payload, dict):
                continue
            data = payload.get("data")
            if not isinstance(data, dict):
                continue

            await self._handle_command(topic.rsplit("/", 1)[-1], cast(JsonObject, data))

    async def _action_loop(self) -> None:
        while True:
            action = await self.actions.get()
            await self._handle_action(action)

    async def _handle_command(self, command: str, data: JsonObject) -> None:
        request_id = data.get("request_id")
        if not isinstance(request_id, str):
            print(f"{self.device_id}: command without request_id", file=sys.stderr)
            return
        if self._is_expired(data):
            await self._publish_response(request_id, "expired", "command_expired")
            return

        if command == "unlock":
            duration_ms = as_int(data.get("duration_ms"), self.state.unlock_ms)
            await self._publish_response(request_id, "ok", None)
            await self._publish_decision("granted", "remote", "remote", None)
            await self._unlock(max(duration_ms, 1))
        elif command == "enroll":
            ttl_s = max(as_int(data.get("ttl_s"), 60), 1)
            self.state.pending_enrollment = request_id
            self.state.pending_enrollment_until = time.monotonic() + ttl_s
            await self._publish_response(request_id, "ok", None)
            print(
                f"{self.device_id}: enrollment open for {ttl_s}s; "
                "run scan <UID> from the console"
            )
        elif command == "synchronize-access-list":
            self._apply_sync(data)
            await self._publish_response(request_id, "ok", None)
            await self._publish_status()
        else:
            await self._publish_response(request_id, "error", "unknown_command")

    async def _handle_action(self, action: str) -> None:
        command, _, argument = action.partition(" ")
        argument = argument.strip()
        uid = argument or DEFAULT_CARD_UID

        if command == "scan":
            await self._scan(uid)
        elif command == "pin":
            parts = argument.split()
            if len(parts) != 2:
                print("Usage: pin <UID> <PIN>")
                return
            await self._pin(parts[0], parts[1])
        elif command == "grant":
            await self._card_access(uid)
        elif command == "deny":
            await self._publish_decision("denied", "acl_absent", "card", uid)
        elif command == "acl":
            print(
                f"{self.device_id}: ACL v{self.state.acl_version}, "
                f"{len(self.state.entries)} entries"
            )
            for entry in self.state.entries:
                uid = str(entry.get("uid", ""))
                masked = (
                    f"{uid[:2]}:..:..:{uid[-2:]}" if len(uid) >= 11 else uid
                )
                print(
                    f"  uid={masked} "
                    f"valid_from={entry.get('valid_from')} "
                    f"valid_to={entry.get('valid_to')}"
                )
        elif command == "stale":
            if argument not in {"on", "off"}:
                print("Usage: stale on|off")
                return
            self.state.stale = argument == "on"
            print(f"{self.device_id}: stale={self.state.stale}")
        elif command == "open":
            await self._publish_decision("granted", "remote", "remote", None)
            await self._unlock(self.state.unlock_ms)
        elif command == "manual":
            await self._publish_decision("unknown", "manual_open", "manual", None)
            await self._unlock(self.state.unlock_ms)
        elif command == "offline":
            if argument not in {"on", "off"}:
                print("Usage: offline on|off")
                return
            await self._publish_status(online=argument == "off")
        elif command == "status":
            await self._publish_status()
        else:
            print(f"{self.device_id}: unknown console command: {command}")

    def _acl_age_s(self) -> int:
        if not self.state.has_acl or self.state.acl_received_at == 0.0:
            return 0
        if self.state.stale:
            return self.state.stale_acl_hours * 3600 + 1
        return max(0, int(time.monotonic() - self.state.acl_received_at))

    async def _card_access(self, uid: str) -> None:
        normalized = uid.upper()
        age_s = self._acl_age_s()

        if self.state.locked:
            reason = "door_locked"
        elif not self.state.has_acl:
            reason = "acl_absent"
        elif age_s > self.state.stale_acl_hours * 3600:
            reason = "acl_stale"
        elif not self.state.online and self.state.offline_policy == "deny":
            reason = "backend_unreachable"
        else:
            entry = next(
                (
                    item
                    for item in self.state.entries
                    if as_str(item.get("uid"), "").upper() == normalized
                ),
                None,
            )
            if entry is None or as_str(entry.get("status"), "") != "active":
                reason = "acl_absent"
            else:
                now = int(time.time())
                valid_from = as_int(entry.get("valid_from"), 0)
                valid_to = entry.get("valid_to")
                if valid_from > now:
                    reason = "not_yet_valid"
                elif isinstance(valid_to, int) and valid_to < now:
                    reason = "expired"
                else:
                    reason = "acl_match"

        granted = reason == "acl_match"
        if granted and self.state.requires_pin:
            # The card is only the first factor; the backend validates the PIN.
            self.state.pending_pin_uid = normalized
            self.state.pending_pin_request_id = str(uuid.uuid4())
            self.state.pending_pin_until = time.monotonic() + PIN_PENDING_TTL_S
            await self._publish_decision(
                "denied", "offline_no_pin", "card", normalized, acl_age_s=age_s
            )
            print(
                f"{self.device_id}: waiting for PIN ({int(PIN_PENDING_TTL_S)} s); "
                "run pin <UID> <PIN>"
            )
            return

        await self._publish_decision(
            "granted" if granted else "denied",
            reason,
            "card",
            normalized,
            acl_age_s=age_s,
        )
        if granted:
            await self._unlock(self.state.unlock_ms)

    async def _scan(self, uid: str) -> None:
        request_id = self.state.pending_enrollment
        if request_id is None or time.monotonic() > self.state.pending_enrollment_until:
            self.state.pending_enrollment = None
            print(f"{self.device_id}: no pending enrollment")
            return

        self.state.pending_enrollment = None
        await self._publish(
            "events/card-scan", {"uid": uid.upper(), "request_id": request_id}
        )

    async def _pin(self, uid: str, pin: str) -> None:
        normalized = uid.upper()
        if (
            self.state.pending_pin_uid != normalized
            or time.monotonic() > self.state.pending_pin_until
        ):
            self.state.pending_pin_uid = None
            self.state.pending_pin_request_id = None
            print(f"{self.device_id}: no pending PIN for {normalized}")
            return

        if len(pin) < 6 or not pin.isdigit():
            print(f"{self.device_id}: PIN must be at least 6 digits")
            return

        request_id = self.state.pending_pin_request_id or str(uuid.uuid4())
        self.state.pending_pin_uid = None
        self.state.pending_pin_request_id = None
        self.state.pending_pin_until = 0.0
        await self._publish(
            "events/pin-entry",
            {"uid": normalized, "pin": pin, "request_id": request_id},
        )

    async def _publish_decision(
        self,
        decision: str,
        reason: str,
        source: str,
        uid: str | None,
        *,
        acl_age_s: int | None = None,
    ) -> None:
        data: JsonObject = {
            "decision": decision,
            "reason": reason,
            "source": source,
        }
        if uid is not None:
            data["uid"] = uid.upper()
            data["acl_version"] = self.state.acl_version
            data["acl_age_s"] = self._acl_age_s() if acl_age_s is None else acl_age_s
            credential_id = self._credential_for(uid)
            if credential_id is not None:
                data["credential_id"] = credential_id
        await self._publish("events/access-decision", data)

    def _credential_for(self, uid: str) -> str | None:
        normalized = uid.upper()
        for entry in self.state.entries:
            if as_str(entry.get("uid"), "").upper() == normalized:
                return as_str(entry.get("credential_id"), "") or None
        return None

    def _apply_sync(self, data: JsonObject) -> None:
        self.state.acl_version = as_int(data.get("acl_version"), self.state.acl_version)
        self.state.requires_pin = bool(
            data.get("requires_pin", self.state.requires_pin)
        )
        if not self.state.requires_pin:
            self.state.pending_pin_uid = None
            self.state.pending_pin_request_id = None
            self.state.pending_pin_until = 0.0
        self.state.locked = bool(data.get("locked", self.state.locked))
        self.state.offline_policy = as_str(
            data.get("offline_policy"), self.state.offline_policy
        )
        self.state.stale_acl_hours = as_int(
            data.get("stale_acl_hours"), self.state.stale_acl_hours
        )
        self.state.unlock_ms = as_int(data.get("unlock_ms"), self.state.unlock_ms)
        entries = data.get("entries")
        if isinstance(entries, list):
            self.state.entries = [
                cast(JsonObject, entry) for entry in entries if isinstance(entry, dict)
            ]
        self.state.has_acl = True
        self.state.stale = False
        self.state.acl_received_at = time.monotonic()
        print(
            f"{self.device_id}: access list synchronized "
            f"v{self.state.acl_version} ({len(self.state.entries)} entries)"
        )

    async def _unlock(self, duration_ms: int) -> None:
        self.state.lock = "unlocked"
        await self._publish_status()
        await self._cancel_relock()
        self._relock_task = asyncio.create_task(
            self._relock_after(duration_ms / 1000.0)
        )

    async def _relock_after(self, delay_s: float) -> None:
        with contextlib.suppress(aiomqtt.MqttError):
            await asyncio.sleep(delay_s)
            self.state.lock = "locked"
            await self._publish_status()

    async def _cancel_relock(self) -> None:
        if self._relock_task is None:
            return
        self._relock_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._relock_task
        self._relock_task = None

    async def _publish_status(self, *, online: bool | None = None) -> None:
        if online is not None:
            self.state.online = online
        await self._publish(
            "status", self._status_data(online=self.state.online), retain=True
        )

    def _status_data(self, *, online: bool) -> JsonObject:
        return {
            "online": online,
            "fw": self.state.firmware,
            "acl_version": self.state.acl_version,
            "requires_pin": self.state.requires_pin,
            "locked": self.state.locked,
            "lock": self.state.lock,
        }

    async def _publish_response(
        self, request_id: str, result: str, reason: str | None
    ) -> None:
        await self._publish(
            "response",
            {"request_id": request_id, "result": result, "reason": reason},
        )

    async def _publish(
        self,
        suffix: str,
        data: JsonObject,
        *,
        qos: int = 1,
        retain: bool = False,
    ) -> None:
        payload = envelope(self.device_id, data)
        await self._require_client().publish(
            f"{self.base_topic}/{suffix}",
            json.dumps(payload, separators=(",", ":")),
            qos=qos,
            retain=retain,
        )
        print(f"{self.device_id}: published {suffix} id={payload['id']}")

    def _require_client(self) -> aiomqtt.Client:
        if self._client is None:
            raise RuntimeError("device is not connected")
        return self._client

    @staticmethod
    def _is_expired(data: JsonObject) -> bool:
        expires_at = data.get("expires_at")
        return isinstance(expires_at, int) and expires_at < int(time.time())


async def console_loop(devices: list[SimulatedDevice], stop: asyncio.Event) -> None:
    if not devices:
        return

    selected = devices[0]
    print(HELP)
    while not stop.is_set():
        try:
            line = (await asyncio.to_thread(input, f"{selected.device_id}> ")).strip()
        except EOFError:
            stop.set()
            return

        if not line:
            continue
        command, _, argument = line.partition(" ")
        command = command.lower()
        argument = argument.strip()

        if command in {"quit", "exit"}:
            stop.set()
            return
        if command == "help":
            print(HELP)
            continue
        if command == "use":
            match = next((item for item in devices if item.device_id == argument), None)
            if match is None:
                print(f"Unknown device: {argument}")
                continue
            selected = match
            continue

        selected.actions.put_nowait(f"{command} {argument}".strip())


async def run(config: Config) -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()

    def request_stop() -> None:
        print("Shutting down", file=sys.stderr)
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, request_stop)

    devices = [SimulatedDevice(item, config) for item in config.devices]
    console_task = (
        asyncio.create_task(console_loop(devices, stop)) if config.interactive else None
    )

    tasks = [asyncio.create_task(device.run(stop)) for device in devices]
    try:
        await stop.wait()
    finally:
        stop.set()
        if console_task is not None:
            console_task.cancel()
            await asyncio.gather(console_task, return_exceptions=True)
        _, pending = await asyncio.wait(tasks, timeout=5)
        for task in pending:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Simulate Safelock MQTT devices")
    parser.add_argument(
        "--url",
        default=os.environ.get("SIM_MQTT_URL", DEFAULT_URL),
        help="Broker URL (mqtt://host:port)",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("SIM_PASSWORD"),
        help="MQTT password (prompted if omitted; prefer SIM_PASSWORD)",
    )
    parser.add_argument(
        "--devices",
        default=os.environ.get("SIM_DEVICES", DEFAULT_DEVICES),
        help="Comma-separated device IDs",
    )
    parser.add_argument(
        "--heartbeat",
        default=os.environ.get("SIM_HEARTBEAT", str(DEFAULT_HEARTBEAT_S)),
        help="Heartbeat interval in seconds",
    )
    parser.add_argument(
        "--no-interactive",
        action="store_true",
        help="Disable the console and only react to MQTT commands",
    )
    return parser


def main() -> None:
    config = build_config(build_parser().parse_args())
    if not config.interactive:
        print("Interactive console disabled")

    try:
        asyncio.run(run(config))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
