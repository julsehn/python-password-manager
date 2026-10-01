#!/usr/bin/env python3
"""Extension permission management tool for Caixa Forta."""

import sys
import os
import json
import time
import argparse

def load_registry():
    """Load extension registry."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extensions.json")
    try:
        with open(path, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"extensions": {}}
    except json.JSONDecodeError:
        return {"extensions": {}}

def save_registry(registry):
    """Save extension registry."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extensions.json")
    with open(path, "w") as f:
        json.dump(registry, f, indent=2)

def list_extensions():
    """List all registered extensions."""
    registry = load_registry()
    
    print("Registered Extensions:")
    print("-" * 60)
    
    for ext_id, entry in registry.get("extensions", {}).items():
        status = "✅ Approved" if entry.get("approved") else "⏳ Pending"
        print(f"{ext_id}: {status}")
        print(f"  Permissions: {', '.join(entry.get('permissions', []))}")
        if entry.get("last_active"):
            print(f"  Last active: {entry['last_active']}")
        print()

def approve_extension(ext_id):
    """Approve an extension."""
    registry = load_registry()
    
    if ext_id not in registry.get("extensions", {}):
        print(f"Extension not found: {ext_id}")
        return
    
    registry["extensions"][ext_id]["approved"] = True
    registry["extensions"][ext_id]["last_active"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")
    save_registry(registry)
    print(f"Extension approved: {ext_id}")

def deny_extension(ext_id):
    """Deny an extension."""
    registry = load_registry()
    
    if ext_id not in registry.get("extensions", {}):
        print(f"Extension not found: {ext_id}")
        return
    
    registry["extensions"][ext_id]["approved"] = False
    save_registry(registry)
    print(f"Extension denied: {ext_id}")

def show_pending():
    """Show extensions pending approval."""
    registry = load_registry()
    
    pending = [
        (ext_id, entry) for ext_id, entry in registry.get("extensions", {}).items()
        if not entry.get("approved")
    ]
    
    if not pending:
        print("No extensions pending approval.")
        return
    
    print("Extensions Pending Approval:")
    print("-" * 60)
    for ext_id, entry in pending:
        print(f"{ext_id}:")
        print(f"  Permissions: {', '.join(entry.get('permissions', []))}")
        if entry.get("last_active"):
            print(f"  Last active: {entry['last_active']}")
        print()

def main():
    parser = argparse.ArgumentParser(description="Manage Caixa Forta extension permissions")
    subparsers = parser.add_subparsers(dest="command")
    
    list_parser = subparsers.add_parser("list", help="List all extensions")
    approve_parser = subparsers.add_parser("approve", help="Approve an extension")
    approve_parser.add_argument("extension_id")
    deny_parser = subparsers.add_parser("deny", help="Deny an extension")
    deny_parser.add_argument("extension_id")
    pending_parser = subparsers.add_parser("pending", help="Show pending approvals")
    
    args = parser.parse_args()
    
    if args.command == "list":
        list_extensions()
    elif args.command == "approve":
        approve_extension(args.extension_id)
    elif args.command == "deny":
        deny_extension(args.extension_id)
    elif args.command == "pending":
        show_pending()
    else:
        parser.print_help()

if __name__ == "__main__":
    main()