#!/usr/bin/env python3
"""Provision a Safelock device over serial/USB."""

from __future__ import annotations

import argparse
import getpass
import re
import sys
import time

import serial

BAUD_RATE = 115200
DEVICE_ID_PATTERN = re.compile(r"^sl-\d{4}$")
MAX_SSID_LENGTH = 32
MAX_WIFI_PASSWORD_LENGTH = 63
MAX_MQTT_PASSWORD_LENGTH = 128
MIN_WIFI_PASSWORD_LENGTH = 8
RESTART_TIMEOUT_S = 30.0


def validate(
    device_id: str, ssid: str, wifi_password: str, mqtt_password: str
) -> str | None:
    """Mirror the firmware validation so bad values never reach NVS."""
    if not DEVICE_ID_PATTERN.fullmatch(device_id):
        return "Invalid device_id; use the format sl-0001"
    if not 1 <= len(ssid) <= MAX_SSID_LENGTH or not printable(ssid):
        return "Invalid WiFi SSID; use 1-32 printable characters"
    if not MIN_WIFI_PASSWORD_LENGTH <= len(
        wifi_password
    ) <= MAX_WIFI_PASSWORD_LENGTH or not printable(wifi_password):
        return "Invalid WiFi password; use 8-63 printable characters"
    if not 1 <= len(mqtt_password) <= MAX_MQTT_PASSWORD_LENGTH or not printable(
        mqtt_password
    ):
        return "Invalid MQTT password; use 1-128 printable characters"
    return None


def printable(value: str) -> bool:
    return all(" " <= character <= "~" and character != '"' for character in value)


def quote(value: str) -> str:
    return f'"{value}"'


def prompt_values() -> tuple[str, str, str, str]:
    device_id = input("Device ID (sl-0001): ").strip().lower()
    ssid = input("WiFi SSID: ").strip()
    wifi_password = getpass.getpass("WiFi password: ")
    mqtt_password = getpass.getpass("MQTT password: ")
    return device_id, ssid, wifi_password, mqtt_password


def confirm(values: tuple[str, str, str, str]) -> bool:
    device_id, ssid, wifi_password, mqtt_password = values
    print("\nReview:")
    print(f"  device_id: {device_id}")
    print(f"  wifi_ssid: {ssid}")
    print(f"  wifi_password: {'****' if wifi_password else '(empty)'}")
    print(f"  mqtt_password: {'****' if mqtt_password else '(empty)'}")
    return input("\nSave and restart? [y/N] ").strip().lower() in {"y", "yes"}


def provision(port_name: str, values: tuple[str, str, str, str]) -> bool:
    device_id, ssid, wifi_password, mqtt_password = values
    commands = [
        f"set device-id {device_id}",
        f"set wifi {quote(ssid)} {quote(wifi_password)}",
        f"set mqtt {quote(mqtt_password)}",
        "commit",
    ]

    with serial.Serial(port_name, BAUD_RATE, timeout=0.2) as port:
        time.sleep(0.5)  # Opening the port may reboot the ESP32.
        port.reset_input_buffer()
        for command in commands:
            port.write(f"{command}\n".encode())
            time.sleep(0.1)

        deadline = time.monotonic() + RESTART_TIMEOUT_S
        saved = False
        while time.monotonic() < deadline:
            line = port.readline().decode("utf-8", errors="replace").strip()
            if not line:
                continue
            print(f"  {line}")
            if "Configuration saved; restarting" in line:
                saved = True
            if saved and line.startswith("Device ID:"):
                return True
            if line.startswith("Invalid ") or line.startswith("Nothing saved"):
                return False
    return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Provision a Safelock device over serial/USB"
    )
    parser.add_argument("--port", required=True, help="Serial port, e.g. /dev/ttyUSB0")
    args = parser.parse_args()

    values = prompt_values()
    error = validate(*values)
    if error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    if not confirm(values):
        print("Cancelled; nothing was written")
        return 1

    print(f"\nProvisioning {args.port} at {BAUD_RATE} baud...")
    try:
        success = provision(args.port, values)
    except serial.SerialException as exc:
        print(f"Error: cannot open {args.port}: {exc}", file=sys.stderr)
        return 1

    if success:
        print("Device restarted with the new configuration")
        return 0
    print(
        "Timed out waiting for the device to restart; check the serial monitor",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
