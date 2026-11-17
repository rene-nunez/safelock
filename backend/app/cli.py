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
from app.services.demo import (
    UnsafeDatabaseError,
    assert_seedable_database,
    reset_demo_data,
    seed_demo_data,
)
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


async def _create_user(
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


def _run_create_user(args: argparse.Namespace) -> None:
    email = _validate_email(args.email or input("Email: "))
    password = args.password or _prompt_password()
    if len(password) < MIN_PASSWORD_LENGTH:
        raise SystemExit(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"
        )

    asyncio.run(_create_user(get_settings(), email, password, args.role))


async def _seed_demo(settings: Settings, *, reset_only: bool) -> None:
    try:
        assert_seedable_database(settings.mongodb_db)
    except UnsafeDatabaseError as error:
        raise SystemExit(str(error)) from error

    client = create_client(settings.mongodb_uri)
    try:
        db = get_database(client, settings.mongodb_db)
        await ensure_indexes(db)
        removed = await reset_demo_data(db)
        print(
            "Removed demo data: "
            + ", ".join(f"{name}={count}" for name, count in removed.items())
        )
        if reset_only:
            return
        created = await seed_demo_data(db)
        print(
            f"Seeded demo data into {settings.mongodb_db}: "
            + ", ".join(f"{name}={count}" for name, count in created.items())
        )
    except PyMongoError as error:
        raise SystemExit(f"Could not reach MongoDB: {error}") from error
    finally:
        await client.close()


def _run_seed_demo(args: argparse.Namespace) -> None:
    asyncio.run(_seed_demo(get_settings(), reset_only=args.reset))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_user = subparsers.add_parser(
        "create-user", help="Create an account (administrator by default)"
    )
    create_user.add_argument("--email", help="Account email (prompted if omitted)")
    create_user.add_argument(
        "--password", help="Account password (prompted if omitted)"
    )
    create_user.add_argument(
        "--role",
        choices=("admin", "operator"),
        default="admin",
        help="Account role (default: admin)",
    )

    seed_demo = subparsers.add_parser(
        "seed-demo", help="Fill a development database with demo data"
    )
    seed_demo.add_argument(
        "--reset", action="store_true", help="Only remove the demo data"
    )

    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    if args.command == "create-user":
        _run_create_user(args)
    elif args.command == "seed-demo":
        _run_seed_demo(args)


if __name__ == "__main__":
    main()
