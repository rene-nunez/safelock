"""Safelock command line utilities."""

import argparse
import asyncio
import getpass
from collections.abc import Sequence

from pydantic import EmailStr, TypeAdapter, ValidationError
from pymongo.errors import PyMongoError

from app.core.config import Settings, get_settings
from app.db.mongo import create_client, ensure_indexes, get_database
from app.schemas.auth import Role
from app.services.audit import record_audit
from app.services.users import UserAlreadyExistsError, create_user, normalize_email

MIN_PASSWORD_LENGTH = 12

_email_adapter = TypeAdapter(EmailStr)


def _validate_email(raw: str) -> str:
    try:
        email = str(_email_adapter.validate_python(raw))
    except ValidationError as error:
        raise SystemExit(f"Invalid email address: {raw}") from error
    return normalize_email(email)


def _prompt_password() -> str:
    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Confirm password: "):
        raise SystemExit("Passwords do not match")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise SystemExit(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"
        )
    return password


async def _create_admin(
    settings: Settings, email: str, password: str, role: Role
) -> None:
    client = create_client(settings.mongodb_uri)
    try:
        db = get_database(client, settings.mongodb_db)
        try:
            await ensure_indexes(db)
            await create_user(db, email, password, role)
        except UserAlreadyExistsError as error:
            raise SystemExit(str(error)) from error
        except PyMongoError as error:
            raise SystemExit(f"Could not reach MongoDB: {error}") from error

        await record_audit(
            db,
            actor_id=None,
            action="user.create",
            target=email,
            after={"email": email, "role": role, "active": True},
        )
    finally:
        await client.close()

    print(f"Created {role} {email}")


def _run_create_admin(args: argparse.Namespace) -> None:
    email = _validate_email(args.email or input("Email: "))
    password = args.password or _prompt_password()
    if len(password) < MIN_PASSWORD_LENGTH:
        raise SystemExit(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"
        )

    asyncio.run(_create_admin(get_settings(), email, password, args.role))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_admin = subparsers.add_parser(
        "create-admin", help="Create an administrator or operator account"
    )
    create_admin.add_argument("--email", help="Account email (prompted if omitted)")
    create_admin.add_argument(
        "--password", help="Account password (prompted if omitted)"
    )
    create_admin.add_argument("--role", choices=("admin", "operator"), default="admin")

    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    if args.command == "create-admin":
        _run_create_admin(args)


if __name__ == "__main__":
    main()
