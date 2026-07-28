"""Shared pytest fixtures for ConKiosk backend tests"""
import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

# Load frontend .env for the public backend URL
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL is required for tests")
if os.environ.get("RUN_INTEGRATION_TESTS", "").lower() != "true":
    raise RuntimeError("Set RUN_INTEGRATION_TESTS=true to run data-changing integration tests")

TEST_SCHOOL_ID = "FAC2024001"
TEST_PASSWORD = "password123"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="session", autouse=True)
def seed_db(api_client):
    """Seed database once per session"""
    r = api_client.post(f"{BASE_URL}/api/seed", timeout=30)
    assert r.status_code == 200, f"Seed failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def auth_token(api_client, seed_db):
    """Login and return a JWT token"""
    r = api_client.post(
        f"{BASE_URL}/api/auth/login",
        json={"school_id": TEST_SCHOOL_ID, "password": TEST_PASSWORD},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"Login failed, cannot run authenticated tests: {r.status_code} {r.text}")
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}
