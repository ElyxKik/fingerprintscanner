import hashlib
import hmac
import secrets
import base64

from cryptography.fernet import Fernet

from app.config import settings

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=64)
    return "scrypt${}${}${}${}${}".format(
        SCRYPT_N,
        SCRYPT_R,
        SCRYPT_P,
        base64.urlsafe_b64encode(salt).decode(),
        base64.urlsafe_b64encode(digest).decode(),
    )


def verify_password(password: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        algorithm, n, r, p, salt_b64, digest_b64 = encoded.split("$", 5)
        if algorithm != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_b64.encode())
        expected = base64.urlsafe_b64decode(digest_b64.encode())
        actual = hashlib.scrypt(password.encode(), salt=salt, n=int(n), r=int(r), p=int(p), dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _fernet() -> Fernet:
    if not settings.pii_encryption_key:
        raise RuntimeError("PII_ENCRYPTION_KEY must be configured before accepting personal data")
    try:
        return Fernet(settings.pii_encryption_key.encode())
    except Exception as exc:
        raise RuntimeError("PII_ENCRYPTION_KEY must be a valid Fernet key") from exc


def encrypt_email(email: str) -> str:
    return _fernet().encrypt(email.strip().lower().encode()).decode()


def lookup_hash(email: str) -> str:
    # Key with a separately managed encryption key to prevent simple email dictionary attacks.
    if not settings.pii_encryption_key:
        raise RuntimeError("PII_ENCRYPTION_KEY must be configured before accepting personal data")
    key = settings.pii_encryption_key.encode()
    return hmac.new(key, email.strip().lower().encode(), hashlib.sha256).hexdigest()


def new_magic_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
