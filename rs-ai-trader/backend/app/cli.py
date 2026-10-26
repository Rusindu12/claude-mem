"""Operator CLI.

    python -m app.cli init-db
    python -m app.cli create-admin --email you@example.com
    python -m app.cli sync-pairs
    python -m app.cli check-health
    python -m app.cli rotate-encryption-key   (documented procedure only)

There is deliberately no hardcoded administrator password anywhere in the
codebase or the APK: the first admin is created by an operator who types the
password locally (or supplies it through an environment variable in CI).
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import sys

from sqlalchemy import select

from .core.config import Settings, get_settings
from .db.base import build_engine, configure_database, create_all, session_scope
from .db.models import User
from .services.app_settings import sync_pairs
from .services.auth import AuthService
from .services.market import build_market_service


def _bootstrap(settings: Settings) -> None:
    engine = build_engine(settings)
    configure_database(engine)


def cmd_init_db(args: argparse.Namespace) -> int:
    settings = get_settings()
    _bootstrap(settings)
    create_all()
    print(f"schema created for {settings.database_url.split('@')[-1]}")
    return 0


def cmd_create_admin(args: argparse.Namespace) -> int:
    settings = get_settings()
    _bootstrap(settings)
    create_all()
    password = args.password or os.environ.get("INITIAL_ADMIN_PASSWORD")
    if not password:
        password = getpass.getpass("Admin password: ")
        confirm = getpass.getpass("Repeat password: ")
        if password != confirm:
            print("passwords do not match", file=sys.stderr)
            return 2
    with session_scope() as db:
        existing = db.scalar(select(User).where(User.email == args.email.lower()))
        if existing is not None:
            print(f"account already exists for {args.email}; use the admin UI to change roles", file=sys.stderr)
            return 3
        user = AuthService(settings).create_admin(db, email=args.email, password=password, display_name=args.name)
        db.commit()
        print(f"admin created: {user.email} ({user.id})")
    return 0


def cmd_sync_pairs(args: argparse.Namespace) -> int:
    settings = get_settings()
    _bootstrap(settings)
    market = build_market_service(settings)
    with session_scope() as db:
        result = sync_pairs(db, market, settings)
        db.commit()
    print(json.dumps(result))
    return 0


def cmd_check_health(args: argparse.Namespace) -> int:
    settings = get_settings()
    _bootstrap(settings)
    market = build_market_service(settings)
    health = market.health()
    print(json.dumps({"market": health, "live_trading_enabled": settings.live_trading_enabled}, indent=2))
    return 0


def cmd_rotate_encryption_key(args: argparse.Namespace) -> int:
    print(
        "Encryption-key rotation is a deliberate, manual operation:\n"
        "1. Generate a new key: python -c \"import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())\"\n"
        "2. Keep the old key available as APP_ENCRYPTION_KEY_OLD.\n"
        "3. Run the documented migration script (docs/DEPLOYMENT.md#key-rotation) to re-encrypt\n"
        "   api_credentials rows, then remove the old key and ask users to re-verify their keys.\n"
        "This CLI intentionally does not perform the rotation automatically.",
        file=sys.stderr,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rs-ai-trader", description="RS AI TRADER backend operator CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init-db", help="create the schema from SQLAlchemy metadata (development)")
    init.set_defaults(func=cmd_init_db)

    admin = sub.add_parser("create-admin", help="create the first administrator account")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", default="Administrator")
    admin.add_argument("--password", help="prefer the interactive prompt or INITIAL_ADMIN_PASSWORD")
    admin.set_defaults(func=cmd_create_admin)

    pairs = sub.add_parser("sync-pairs", help="refresh trading pairs and exchange filters")
    pairs.set_defaults(func=cmd_sync_pairs)

    health = sub.add_parser("check-health", help="print market-data health")
    health.set_defaults(func=cmd_check_health)

    rotate = sub.add_parser("rotate-encryption-key", help="documented procedure for key rotation")
    rotate.set_defaults(func=cmd_rotate_encryption_key)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
