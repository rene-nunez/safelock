import re

UID_BYTE_LENGTHS = (4, 7, 10)
_DEVICE_ID_PATTERN = re.compile(r"^sl-\d{4}$")


class InvalidUidError(ValueError):
    pass


class InvalidDeviceIdError(ValueError):
    pass


def normalize_uid(raw: str) -> str:
    cleaned = re.sub(r"[\s:\-]", "", raw).upper()
    if (
        len(cleaned) // 2 not in UID_BYTE_LENGTHS
        or len(cleaned) % 2 != 0
        or re.fullmatch(r"[0-9A-F]+", cleaned) is None
    ):
        raise InvalidUidError(
            "UID must be 4, 7 or 10 bytes written in hexadecimal"
        )
    return ":".join(cleaned[index : index + 2] for index in range(0, len(cleaned), 2))


def normalize_device_id(raw: str) -> str:
    device_id = raw.strip().lower()
    if _DEVICE_ID_PATTERN.fullmatch(device_id) is None:
        raise InvalidDeviceIdError("Device ID must look like sl-0001")
    return device_id
