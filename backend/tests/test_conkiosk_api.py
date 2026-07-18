"""Backend API tests for ConKiosk Faculty Mobile App"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


# ==================== Auth tests ====================
class TestAuth:
    def test_login_success(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"school_id": "FAC2024001", "password": "password123"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["faculty"]["school_id"] == "FAC2024001"
        assert "password_hash" not in data["faculty"]
        assert isinstance(data["faculty"].get("_id"), str)

    def test_login_wrong_password(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"school_id": "FAC2024001", "password": "wrong"},
        )
        assert r.status_code == 401

    def test_login_wrong_school_id(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"school_id": "NOTREAL", "password": "password123"},
        )
        assert r.status_code == 401

    def test_protected_without_token(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/faculty/profile")
        assert r.status_code in (401, 403)  # HTTPBearer returns 403 when missing

    def test_protected_with_bad_token(self, api_client):
        r = requests.get(
            f"{BASE_URL}/api/faculty/profile",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert r.status_code == 401


# ==================== Faculty profile tests ====================
class TestFacultyProfile:
    def test_get_profile(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/faculty/profile", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["school_id"] == "FAC2024001"
        assert "password_hash" not in data
        assert data["full_name"] == "Dr. Maria Santos"
        assert isinstance(data["_id"], str)

    def test_update_profile_and_persist(self, api_client, auth_headers):
        payload = {
            "full_name": "TEST_Dr. Maria Santos Updated",
            "office_location": "TEST_Room 999",
            "office_hours": "TEST_Mon 10-12",
        }
        r = api_client.patch(
            f"{BASE_URL}/api/faculty/profile", json=payload, headers=auth_headers
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["full_name"] == payload["full_name"]
        assert data["office_location"] == payload["office_location"]

        # verify persistence via GET
        r2 = api_client.get(f"{BASE_URL}/api/faculty/profile", headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["office_hours"] == payload["office_hours"]

        # restore
        api_client.patch(
            f"{BASE_URL}/api/faculty/profile",
            json={
                "full_name": "Dr. Maria Santos",
                "office_location": "Room 301, Science Building",
                "office_hours": "Mon-Fri 9:00 AM - 5:00 PM",
            },
            headers=auth_headers,
        )

    def test_update_availability(self, api_client, auth_headers):
        for status_val in ["busy", "unavailable", "available"]:
            r = api_client.patch(
                f"{BASE_URL}/api/faculty/availability",
                json={"status": status_val},
                headers=auth_headers,
            )
            assert r.status_code == 200, r.text
            assert r.json()["status"] == status_val

        # Verify persistence via profile
        p = api_client.get(f"{BASE_URL}/api/faculty/profile", headers=auth_headers)
        assert p.json()["availability_status"] == "available"


# ==================== Dashboard tests ====================
class TestDashboard:
    def test_dashboard_stats(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/dashboard/stats", headers=auth_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        for key in [
            "today_count",
            "pending_requests",
            "upcoming_consultations",
            "recent_activity",
            "monthly_count",
            "availability_status",
        ]:
            assert key in data, f"missing key {key}"
        assert isinstance(data["pending_requests"], int)
        assert data["pending_requests"] >= 3  # from seed
        assert isinstance(data["upcoming_consultations"], list)
        assert isinstance(data["recent_activity"], list)


# ==================== Consultation Requests tests ====================
class TestConsultationRequests:
    def test_list_requests(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/consultation-requests", headers=auth_headers
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 3
        for item in data:
            assert isinstance(item["_id"], str)
            assert "student_name" in item

    def test_list_requests_filter_pending(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/consultation-requests?status=pending",
            headers=auth_headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert all(x["status"] == "pending" for x in data)
        assert len(data) >= 3

    def test_accept_request_creates_consultation(self, api_client, auth_headers):
        # Get pending
        r = api_client.get(
            f"{BASE_URL}/api/consultation-requests?status=pending",
            headers=auth_headers,
        )
        pending = r.json()
        assert len(pending) >= 1
        req_id = pending[0]["_id"]
        student_name = pending[0]["student_name"]

        # accept
        r2 = api_client.post(
            f"{BASE_URL}/api/consultation-requests/{req_id}/action",
            json={"action": "accept"},
            headers=auth_headers,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "accepted"

        # Verify request status changed
        r3 = api_client.get(
            f"{BASE_URL}/api/consultation-requests/{req_id}", headers=auth_headers
        )
        assert r3.status_code == 200
        assert r3.json()["status"] == "accepted"

        # Verify consultation record now exists in history
        r4 = api_client.get(
            f"{BASE_URL}/api/consultations?search={student_name}",
            headers=auth_headers,
        )
        assert r4.status_code == 200
        assert any(c["student_name"] == student_name for c in r4.json())

    def test_decline_request(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/consultation-requests?status=pending",
            headers=auth_headers,
        )
        pending = r.json()
        if not pending:
            pytest.skip("No pending requests to decline")
        req_id = pending[0]["_id"]

        r2 = api_client.post(
            f"{BASE_URL}/api/consultation-requests/{req_id}/action",
            json={"action": "decline", "reason": "TEST_conflict"},
            headers=auth_headers,
        )
        assert r2.status_code == 200
        assert r2.json()["status"] == "declined"

        r3 = api_client.get(
            f"{BASE_URL}/api/consultation-requests/{req_id}", headers=auth_headers
        )
        assert r3.json()["status"] == "declined"
        assert r3.json().get("decline_reason") == "TEST_conflict"

    def test_reschedule_request(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/consultation-requests?status=pending",
            headers=auth_headers,
        )
        pending = r.json()
        if not pending:
            pytest.skip("No pending requests to reschedule")
        req_id = pending[0]["_id"]

        r2 = api_client.post(
            f"{BASE_URL}/api/consultation-requests/{req_id}/action",
            json={
                "action": "reschedule",
                "reschedule_date": "2026-02-15",
                "reschedule_time": "11:00 AM",
            },
            headers=auth_headers,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "rescheduled"

        r3 = api_client.get(
            f"{BASE_URL}/api/consultation-requests/{req_id}", headers=auth_headers
        )
        data = r3.json()
        assert data["status"] == "rescheduled"
        assert data["preferred_date"] == "2026-02-15"
        assert data["preferred_time"] == "11:00 AM"

    def test_reschedule_missing_fields(self, api_client, auth_headers):
        # create a fresh request scenario: re-seed to have pending items
        api_client.post(f"{BASE_URL}/api/seed")
        r = api_client.get(
            f"{BASE_URL}/api/consultation-requests?status=pending",
            headers=auth_headers,
        )
        req_id = r.json()[0]["_id"]
        r2 = api_client.post(
            f"{BASE_URL}/api/consultation-requests/{req_id}/action",
            json={"action": "reschedule"},
            headers=auth_headers,
        )
        assert r2.status_code == 400

    def test_invalid_action(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/consultation-requests?status=pending",
            headers=auth_headers,
        )
        req_id = r.json()[0]["_id"]
        r2 = api_client.post(
            f"{BASE_URL}/api/consultation-requests/{req_id}/action",
            json={"action": "nope"},
            headers=auth_headers,
        )
        assert r2.status_code == 400


# ==================== Consultations History tests ====================
class TestConsultationsHistory:
    def test_get_history(self, api_client, auth_headers):
        # Ensure at least seed history exists
        api_client.post(f"{BASE_URL}/api/seed")
        r = api_client.get(f"{BASE_URL}/api/consultations", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 2
        for c in data:
            assert isinstance(c["_id"], str)

    def test_filter_completed(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/consultations?status=completed", headers=auth_headers
        )
        assert r.status_code == 200
        data = r.json()
        assert all(c["status"] == "completed" for c in data)
        assert len(data) >= 2

    def test_search_by_name(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/consultations?search=Anna", headers=auth_headers
        )
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1
        assert any("Anna" in c["student_name"] for c in data)

    def test_update_consultation(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/consultations", headers=auth_headers)
        cid = r.json()[0]["_id"]

        r2 = api_client.patch(
            f"{BASE_URL}/api/consultations/{cid}",
            json={
                "notes": "TEST_updated notes",
                "remarks": "TEST_remarks",
                "status": "completed",
                "duration": 60,
            },
            headers=auth_headers,
        )
        assert r2.status_code == 200, r2.text
        updated = r2.json()
        assert updated["notes"] == "TEST_updated notes"
        assert updated["duration"] == 60

        # Verify persistence via GET
        r3 = api_client.get(
            f"{BASE_URL}/api/consultations/{cid}", headers=auth_headers
        )
        assert r3.status_code == 200
        assert r3.json()["remarks"] == "TEST_remarks"


# ==================== Notifications tests ====================
class TestNotifications:
    def test_list_notifications(self, api_client, auth_headers):
        api_client.post(f"{BASE_URL}/api/seed")
        r = api_client.get(f"{BASE_URL}/api/notifications", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 2
        for n in data:
            assert isinstance(n["_id"], str)
            assert "read" in n

    def test_mark_read(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/notifications", headers=auth_headers)
        nid = r.json()[0]["_id"]
        r2 = api_client.patch(
            f"{BASE_URL}/api/notifications/{nid}/read", headers=auth_headers
        )
        assert r2.status_code == 200
        # Verify read state
        r3 = api_client.get(
            f"{BASE_URL}/api/notifications", headers=auth_headers
        )
        target = next(n for n in r3.json() if n["_id"] == nid)
        assert target["read"] is True

    def test_mark_all_read(self, api_client, auth_headers):
        api_client.post(f"{BASE_URL}/api/seed")
        r = api_client.post(
            f"{BASE_URL}/api/notifications/mark-all-read", headers=auth_headers
        )
        assert r.status_code == 200
        # Verify all are read
        r2 = api_client.get(
            f"{BASE_URL}/api/notifications?unread_only=true", headers=auth_headers
        )
        assert r2.status_code == 200
        assert r2.json() == []


# ==================== Change password tests ====================
class TestChangePassword:
    def test_change_password_wrong_current(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/auth/change-password",
            json={"current_password": "wrong", "new_password": "abc12345"},
            headers=auth_headers,
        )
        assert r.status_code == 400

    def test_change_password_success_and_relogin(self, api_client, auth_headers):
        # change
        r = api_client.post(
            f"{BASE_URL}/api/auth/change-password",
            json={"current_password": "password123", "new_password": "TEST_newpass1"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text

        # login with new pwd
        r2 = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"school_id": "FAC2024001", "password": "TEST_newpass1"},
        )
        assert r2.status_code == 200

        # restore original via new token
        new_headers = {
            "Authorization": f"Bearer {r2.json()['access_token']}",
            "Content-Type": "application/json",
        }
        r3 = api_client.post(
            f"{BASE_URL}/api/auth/change-password",
            json={"current_password": "TEST_newpass1", "new_password": "password123"},
            headers=new_headers,
        )
        assert r3.status_code == 200
