"""
Production-grade input validation and sanitization for the auction system.

This module provides validators and sanitizers for all user inputs to prevent:
- SQL injection
- XSS attacks
- Type confusion
- Buffer overflows
- Denial of service
"""

import re
from collections.abc import Callable
from datetime import datetime
from typing import Any

# Constraints
MAX_STRING_LENGTH = 1000
MAX_ARRAY_LENGTH = 1000
MAX_OBJECT_DEPTH = 10
MAX_PLAYER_ID_LENGTH = 50
MAX_AUCTION_ID_LENGTH = 36
MAX_TEAM_ID_LENGTH = 10
MIN_BID_AMOUNT = 10  # Rs. 10 lakhs (base price)
MAX_BID_AMOUNT = 50000  # Rs. 50 crores


class ValidationError(Exception):
    """Raised when input validation fails."""

    def __init__(self, field: str, message: str, code: str = "VALIDATION_ERROR"):
        self.field = field
        self.code = code
        super().__init__(f"Validation failed for '{field}': {message}")


class SanitizationError(Exception):
    """Raised when input sanitization fails."""

    def __init__(self, field: str, reason: str):
        self.field = field
        super().__init__(f"Sanitization failed for '{field}': {reason}")


# Regex patterns
UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
EMAIL_PATTERN = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
URL_PATTERN = re.compile(
    r"^https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]*)?$"
)
PLAYER_ID_PATTERN = re.compile(r"^[0-9]{5,7}$")
TEAM_ID_PATTERN = re.compile(r"^[A-Z]{2,3}$")


def validate_uuid(value: Any, field_name: str = "id") -> str:
    """Validate UUID format."""
    if not isinstance(value, str):
        raise ValidationError(field_name, "Must be a string")

    if not UUID_PATTERN.match(value):
        raise ValidationError(field_name, "Invalid UUID format")

    return value


def validate_email(value: Any, field_name: str = "email") -> str:
    """Validate email address."""
    if not isinstance(value, str):
        raise ValidationError(field_name, "Must be a string")

    if len(value) > MAX_STRING_LENGTH:
        raise ValidationError(field_name, f"Must be ≤ {MAX_STRING_LENGTH} characters")

    if not EMAIL_PATTERN.match(value):
        raise ValidationError(field_name, "Invalid email format")

    return value.lower()


def validate_url(value: Any, field_name: str = "url") -> str:
    """Validate URL format."""
    if not isinstance(value, str):
        raise ValidationError(field_name, "Must be a string")

    if len(value) > MAX_STRING_LENGTH:
        raise ValidationError(field_name, f"Must be ≤ {MAX_STRING_LENGTH} characters")

    if not URL_PATTERN.match(value):
        raise ValidationError(field_name, "Invalid URL format")

    return value


def validate_string(
    value: Any,
    field_name: str,
    min_length: int = 1,
    max_length: int = MAX_STRING_LENGTH,
    pattern: re.Pattern[str] | None = None,
) -> str:
    """Validate string input."""
    if not isinstance(value, str):
        raise ValidationError(field_name, "Must be a string")

    if len(value) < min_length:
        raise ValidationError(field_name, f"Must be ≥ {min_length} characters")

    if len(value) > max_length:
        raise ValidationError(field_name, f"Must be ≤ {max_length} characters")

    if pattern and not pattern.match(value):
        raise ValidationError(field_name, "Does not match required pattern")

    return value


def validate_integer(
    value: Any,
    field_name: str,
    min_value: int | None = None,
    max_value: int | None = None,
) -> int:
    """Validate integer input."""
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValidationError(field_name, "Must be an integer")

    if min_value is not None and value < min_value:
        raise ValidationError(field_name, f"Must be ≥ {min_value}")

    if max_value is not None and value > max_value:
        raise ValidationError(field_name, f"Must be ≤ {max_value}")

    return value


def validate_float(
    value: Any,
    field_name: str,
    min_value: float | None = None,
    max_value: float | None = None,
) -> float:
    """Validate float input."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValidationError(field_name, "Must be a number")

    fvalue = float(value)

    if min_value is not None and fvalue < min_value:
        raise ValidationError(field_name, f"Must be ≥ {min_value}")

    if max_value is not None and fvalue > max_value:
        raise ValidationError(field_name, f"Must be ≤ {max_value}")

    return fvalue


def validate_boolean(value: Any, field_name: str = "value") -> bool:
    """Validate boolean input."""
    if not isinstance(value, bool):
        raise ValidationError(field_name, "Must be a boolean")

    return value


def validate_enum(
    value: Any, allowed_values: list[str], field_name: str = "value"
) -> str:
    """Validate enum value."""
    if not isinstance(value, str):
        raise ValidationError(field_name, "Must be a string")

    if value not in allowed_values:
        raise ValidationError(
            field_name, f"Must be one of: {', '.join(allowed_values)}"
        )

    return value


def validate_player_id(value: Any) -> str:
    """Validate player ID (numeric Cricsheet ID)."""
    return validate_string(
        value,
        "player_id",
        min_length=5,
        max_length=MAX_PLAYER_ID_LENGTH,
        pattern=PLAYER_ID_PATTERN,
    )


def validate_team_id(value: Any) -> str:
    """Validate team ID (IPL team abbreviation)."""
    return validate_string(
        value,
        "team_id",
        min_length=2,
        max_length=MAX_TEAM_ID_LENGTH,
        pattern=TEAM_ID_PATTERN,
    )


def validate_auction_id(value: Any) -> str:
    """Validate auction ID (UUID)."""
    return validate_uuid(value, "auction_id")


def validate_bid_amount(value: Any) -> int:
    """Validate bid amount in crores."""
    return validate_integer(
        value, "bid_amount", min_value=MIN_BID_AMOUNT, max_value=MAX_BID_AMOUNT
    )


def validate_array(
    value: Any,
    field_name: str,
    item_validator: Callable[[Any], Any] | None = None,
    min_items: int = 0,
    max_items: int = MAX_ARRAY_LENGTH,
) -> list:
    """Validate array/list input."""
    if not isinstance(value, list):
        raise ValidationError(field_name, "Must be an array")

    if len(value) < min_items:
        raise ValidationError(field_name, f"Must have ≥ {min_items} items")

    if len(value) > max_items:
        raise ValidationError(field_name, f"Must have ≤ {max_items} items")

    if item_validator:
        return [item_validator(item) for item in value]

    return value


def validate_datetime(value: Any, field_name: str = "timestamp") -> datetime:
    """Validate ISO 8601 datetime string."""
    if isinstance(value, datetime):
        return value

    if not isinstance(value, str):
        raise ValidationError(field_name, "Must be a string or datetime")

    try:
        # Parse ISO 8601 format
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as err:
        raise ValidationError(field_name, "Invalid ISO 8601 datetime format") from err


# ============================================================================
# Sanitization Functions
# ============================================================================


def sanitize_string(value: str, max_length: int = MAX_STRING_LENGTH) -> str:
    """Sanitize string to prevent XSS and injection."""
    if not isinstance(value, str):
        value = str(value)

    # Remove null bytes
    value = value.replace("\x00", "")

    # Truncate
    value = value[:max_length]

    # HTML escape dangerous characters (for display purposes)
    replacements = {
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
        "&": "&amp;",
    }

    for char, escape in replacements.items():
        value = value.replace(char, escape)

    return value.strip()


def sanitize_sql_identifier(value: str) -> str:
    """Sanitize SQL identifier (table name, column name)."""
    # Only allow alphanumeric and underscore
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", value):
        raise SanitizationError("sql_identifier", "Invalid SQL identifier format")

    return value


def sanitize_json_value(value: Any) -> Any:
    """Recursively sanitize JSON values."""
    if isinstance(value, dict):
        return {k: sanitize_json_value(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [sanitize_json_value(v) for v in value]
    elif isinstance(value, str):
        return sanitize_string(value)
    elif isinstance(value, (int, float, bool, type(None))):
        return value
    else:
        return str(value)


# ============================================================================
# Composite Validators
# ============================================================================


class BidValidator:
    """Validator for auction bid submissions."""

    @staticmethod
    def validate(data: dict[str, Any]) -> dict[str, Any]:
        """Validate bid submission."""
        return {
            "auction_id": validate_auction_id(data.get("auction_id")),
            "player_id": validate_player_id(data.get("player_id")),
            "team_id": validate_team_id(data.get("team_id")),
            "amount": validate_bid_amount(data.get("amount")),
            "agent_id": validate_string(
                data.get("agent_id"), "agent_id", max_length=50
            ),
        }


class PlayerValidator:
    """Validator for player data."""

    @staticmethod
    def validate(data: dict[str, Any]) -> dict[str, Any]:
        """Validate player record."""
        return {
            "player_id": validate_player_id(data.get("player_id")),
            "canonical_name": validate_string(
                data.get("canonical_name"), "canonical_name", max_length=100
            ),
            "role": validate_enum(
                data.get("role"), ["batter", "bowler", "keeper", "allrounder"]
            ),
            "nationality": validate_string(
                data.get("nationality"), "nationality", min_length=2, max_length=3
            ),
            "base_price": validate_integer(
                data.get("base_price"), "base_price", min_value=1, max_value=MAX_BID_AMOUNT
            ),
        }


class AuctionSessionValidator:
    """Validator for auction session creation."""

    @staticmethod
    def validate(data: dict[str, Any]) -> dict[str, Any]:
        """Validate auction session data."""
        return {
            "title": validate_string(data.get("title"), "title", max_length=200),
            "players": validate_array(
                data.get("players", []),
                "players",
                lambda p: validate_player_id(p),
                min_items=50,
                max_items=500,
            ),
            "teams": validate_array(
                data.get("teams", []),
                "teams",
                lambda t: validate_team_id(t),
                min_items=10,
                max_items=10,
            ),
        }


if __name__ == "__main__":
    # Test examples
    print("✅ Validation module loaded successfully")

    try:
        validate_uuid("not-a-uuid")
    except ValidationError as e:
        print(f"✅ Validation error caught: {e}")

    test_str = '<script>alert("xss")</script>'
    print(f"✅ Sanitized: {sanitize_string(test_str)}")
