"""Auth JWKS must not depend on a dead desktop proxy."""
from unittest.mock import MagicMock, patch

import httpx
import pytest

import auth_clerk


def test_direct_jwks_fetch_ignores_proxy_environment():
    response = MagicMock()
    response.json.return_value = {"keys": [{"kid": "test"}]}
    response.raise_for_status.return_value = None
    client = MagicMock()
    client.__enter__.return_value.get.return_value = response
    with patch.object(auth_clerk.httpx, "Client", return_value=client) as factory:
        auth_clerk._DirectPyJWKClient("https://example.test/.well-known/jwks.json").fetch_data()
    assert factory.call_args.kwargs["trust_env"] is False
    assert factory.call_args.kwargs["follow_redirects"] is True


def test_direct_jwks_fetch_preserves_cache_on_success():
    response = MagicMock()
    response.json.return_value = {"keys": [{"kid": "test"}]}
    response.raise_for_status.return_value = None
    client = MagicMock()
    client.__enter__.return_value.get.return_value = response
    jwks = auth_clerk._DirectPyJWKClient("https://example.test/.well-known/jwks.json")
    with patch.object(auth_clerk.httpx, "Client", return_value=client):
        result = jwks.fetch_data()
    assert result["keys"][0]["kid"] == "test"


def test_direct_jwks_fetch_translates_network_error():
    client = MagicMock()
    client.__enter__.return_value.get.side_effect = httpx.ConnectError("connection refused")
    jwks = auth_clerk._DirectPyJWKClient("https://example.test/.well-known/jwks.json")
    with patch.object(auth_clerk.httpx, "Client", return_value=client):
        with pytest.raises(auth_clerk.PyJWKClientConnectionError, match="Fail to fetch data"):
            jwks.fetch_data()
