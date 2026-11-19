"""MQTT gateway: ingests device status, heartbeat and access decisions."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import ssl
from collections import OrderedDict
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import aiomqtt
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

from app.core.config import Settings
from app.core.identifiers import InvalidUidError, normalize_uid
from app.db.mongo import Database
from app.schemas.mqtt import (
    AccessDecisionData,
    HeartbeatData,
    MessageEnvelope,
    StatusData,
)

logger = logging.getLogger(__name__)

TOPIC_PREFIX = "safelock/devices"
KNOWN_KINDS = {"status", "heartbeat", "events/access-decision"}
MAX_SEEN_IDS = 10_000
FUTURE_TS_TOLERANCE_S = 300
RECONNECT_DELAY_S = 5.0
_DEVICE_ID_PATTERN = re.compile(r"^sl-\d{4}$")


class ParsedMessage:
    def __init__(self, device_id: str, kind: str, envelope: MessageEnvelope) -> None:
        self.device_id = device_id
        self.kind = kind
        self.envelope = envelope


def parse_topic(topic: str) -> tuple[str, str] | None:
    parts = topic.split("/")
    if len(parts) < 4 or parts[:2] != ["safelock", "devices"]:
        return None
    device_id = parts[2]
    if _DEVICE_ID_PATTERN.fullmatch(device_id) is None:
        return None
    return device_id, "/".join(parts[3:])


def parse_message(topic: str, payload: bytes) -> ParsedMessage | None:
    parsed_topic = parse_topic(topic)
    if parsed_topic is None:
        logger.warning("MQTT message with invalid topic type=unknown")
        return None
    device_id, kind = parsed_topic

    try:
        envelope = MessageEnvelope.model_validate(json.loads(payload))
    except (UnicodeDecodeError, json.JSONDecodeError, ValidationError):
        # Never log the payload: it may contain a PIN or a card UID.
        logger.warning("MQTT message with invalid envelope type=%s", kind)
        return None

    if envelope.device_id != device_id:
        logger.warning(
            "MQTT device mismatch id=%s device_id=%s type=%s",
            envelope.id,
            device_id,
            kind,
        )
        return None

    return ParsedMessage(device_id, kind, envelope)


class MqttGateway:
    def __init__(self, db: Database, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        self._seen_ids: OrderedDict[str, None] = OrderedDict()
        self._rtc_valid: dict[str, bool] = {}

    def _remember_id(self, message_id: str) -> bool:
        if message_id in self._seen_ids:
            return False
        self._seen_ids[message_id] = None
        if len(self._seen_ids) > MAX_SEEN_IDS:
            self._seen_ids.popitem(last=False)
        return True

    def _connection(self) -> tuple[str, int, ssl.SSLContext | None]:
        parsed = urlparse(self.settings.mqtt_url)
        if parsed.scheme not in {"mqtt", "mqtts"} or not parsed.hostname:
            raise ValueError("MQTT_URL must be an mqtt:// or mqtts:// URL")
        port = parsed.port or (8883 if parsed.scheme == "mqtts" else 1883)
        use_tls = self.settings.mqtt_tls or parsed.scheme == "mqtts"
        context: ssl.SSLContext | None = None
        if use_tls:
            if self.settings.mqtt_ca_path:
                context = ssl.create_default_context(cafile=self.settings.mqtt_ca_path)
            else:
                context = ssl.create_default_context()
                logger.warning("MQTT TLS is enabled without MQTT_CA_PATH")
        return parsed.hostname, port, context

    def _client(self) -> aiomqtt.Client:
        hostname, port, context = self._connection()
        return aiomqtt.Client(
            hostname=hostname,
            port=port,
            username=self.settings.mqtt_username or None,
            password=self.settings.mqtt_password or None,
            identifier="safelock-backend",
            protocol=aiomqtt.ProtocolVersion.V311,
            tls_context=context,
            keepalive=60,
        )

    async def run(self) -> None:
        while True:
            try:
                async with self._client() as client:
                    await client.subscribe(f"{TOPIC_PREFIX}/+/status", qos=1)
                    await client.subscribe(f"{TOPIC_PREFIX}/+/heartbeat", qos=0)
                    await client.subscribe(f"{TOPIC_PREFIX}/+/events/#", qos=1)
                    logger.info("MQTT gateway connected")
                    async for message in client.messages:
                        await self.handle_message(
                            str(message.topic), bytes(message.payload)
                        )
            except asyncio.CancelledError:
                raise
            except (aiomqtt.MqttError, OSError, ssl.SSLError, ValueError) as error:
                logger.warning("MQTT gateway disconnected: %s", error)
                await asyncio.sleep(RECONNECT_DELAY_S)

    async def handle_message(self, topic: str, payload: bytes) -> None:
        parsed = parse_message(topic, payload)
        if parsed is None:
            return

        try:
            await self._dispatch(parsed)
        except Exception:
            # One bad message (for example a database error) must not stop the consumer. Never log the payload: it may contain a PIN or a UID.
            logger.exception(
                "MQTT message handling failed id=%s device_id=%s type=%s",
                parsed.envelope.id,
                parsed.device_id,
                parsed.kind,
            )

    async def _dispatch(self, parsed: ParsedMessage) -> None:
        device_id, kind, envelope = (
            parsed.device_id,
            parsed.kind,
            parsed.envelope,
        )
        if kind not in KNOWN_KINDS:
            logger.debug(
                "Ignoring MQTT type=%s id=%s device_id=%s", kind, envelope.id, device_id
            )
            return

        device = await self.db.devices.find_one(
            {"device_id": device_id}, {"_id": 1}
        )
        if device is None:
            logger.warning(
                "MQTT message from unknown device id=%s device_id=%s type=%s",
                envelope.id,
                device_id,
                kind,
            )
            return

        # The LWT is a fixed payload published by the broker, so it must never be discarded as a duplicate.
        is_lwt = kind == "status" and envelope.data.get("online") is False
        if not is_lwt and not self._remember_id(envelope.id):
            logger.debug(
                "Discarding duplicate MQTT id=%s device_id=%s type=%s",
                envelope.id,
                device_id,
                kind,
            )
            return

        if kind == "status":
            await self._handle_status(device_id, envelope)
        elif kind == "heartbeat":
            await self._handle_heartbeat(device_id, envelope)
        else:
            await self._handle_access_decision(device_id, envelope)

    async def _handle_status(self, device_id: str, envelope: MessageEnvelope) -> None:
        try:
            status = StatusData.model_validate(envelope.data)
        except ValidationError:
            logger.warning(
                "Invalid MQTT status id=%s device_id=%s", envelope.id, device_id
            )
            return

        now = datetime.now(UTC)
        updates: dict[str, Any] = {"updated_at": now, "online": status.online}
        if status.online:
            updates["last_seen"] = now
        for field in ("fw", "acl_version", "requires_pin", "locked", "lock"):
            value = getattr(status, field)
            if value is not None:
                updates[field] = value

        await self.db.devices.update_one(
            {"device_id": device_id}, {"$set": updates}
        )
        logger.info(
            "MQTT status device_id=%s online=%s acl_version=%s",
            device_id,
            status.online,
            status.acl_version,
        )

    async def _handle_heartbeat(
        self, device_id: str, envelope: MessageEnvelope
    ) -> None:
        try:
            heartbeat = HeartbeatData.model_validate(envelope.data)
        except ValidationError:
            logger.warning(
                "Invalid MQTT heartbeat id=%s device_id=%s", envelope.id, device_id
            )
            return

        self._rtc_valid[device_id] = heartbeat.rtc_valid
        now = datetime.now(UTC)
        await self.db.devices.update_one(
            {"device_id": device_id},
            {
                "$set": {
                    "last_seen": now,
                    "online": True,
                    "updated_at": now,
                    "telemetry": heartbeat.model_dump(exclude_none=True),
                }
            },
        )
        logger.info(
            "MQTT heartbeat device_id=%s rtc_valid=%s",
            device_id,
            heartbeat.rtc_valid,
        )

    async def _handle_access_decision(
        self, device_id: str, envelope: MessageEnvelope
    ) -> None:
        try:
            decision = AccessDecisionData.model_validate(envelope.data)
        except ValidationError:
            logger.warning(
                "Invalid MQTT access decision id=%s device_id=%s",
                envelope.id,
                device_id,
            )
            return

        now = datetime.now(UTC)
        rtc_valid = self._rtc_valid.get(device_id, True)
        degraded = (
            not rtc_valid
            or envelope.ts <= 0
            or envelope.ts > int(now.timestamp()) + FUTURE_TS_TOLERANCE_S
        )
        event_ts = now if degraded else datetime.fromtimestamp(envelope.ts, UTC)

        uid = decision.uid
        if uid is not None:
            try:
                uid = normalize_uid(uid)
            except InvalidUidError:
                logger.warning(
                    "Invalid UID in event id=%s device_id=%s", envelope.id, device_id
                )
                uid = None

        document: dict[str, Any] = {
            "device_id": device_id,
            "ts": event_ts,
            "uid": uid,
            "credential_id": decision.credential_id,
            "decision": decision.decision,
            "reason": decision.reason,
            "source": decision.source,
            "request_id": None,
            "mqtt_id": envelope.id,
            "degraded": degraded,
            "acl_version": decision.acl_version,
            "acl_age_s": decision.acl_age_s,
            "created_at": now,
        }
        try:
            await self.db.access_events.insert_one(document)
        except DuplicateKeyError:
            logger.debug("Discarding duplicate event id=%s", envelope.id)
            return

        logger.info(
            "MQTT access-decision device_id=%s decision=%s reason=%s",
            device_id,
            decision.decision,
            decision.reason,
        )
