"""Retest iteration 3 for ConKiosk:
- All 5 endpoints must return 400 (not 500) for malformed ObjectId
- Accept branch propagates queue_id/queue_number/consultation_type from kiosk requests
- End-to-end: kiosk-request -> accept -> start -> complete -> TV display reflects it
- Decline of a kiosk-originated request cancels the linked queue entry
"""
import os
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


# ==================== 400 on malformed id for all 5 endpoints ====================
class TestMalformedIdReturns400:
    def test_action_400(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/consultation-requests/not-a-valid-id/action",
            json={"action": "accept"}, headers=auth_headers,
        )
        assert r.status_code == 400, r.text

    def test_get_consultation_request_400(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/consultation-requests/not-a-valid-id",
            headers=auth_headers,
        )
        assert r.status_code == 400, r.text

    def test_get_consultation_400(self, api_client, auth_headers):
        r = api_client.get(
            f"{BASE_URL}/api/consultations/not-a-valid-id",
            headers=auth_headers,
        )
        assert r.status_code == 400, r.text

    def test_patch_consultation_400(self, api_client, auth_headers):
        r = api_client.patch(
            f"{BASE_URL}/api/consultations/not-a-valid-id",
            json={"topic": "TEST"}, headers=auth_headers,
        )
        assert r.status_code == 400, r.text

    def test_patch_notification_read_400(self, api_client, auth_headers):
        r = api_client.patch(
            f"{BASE_URL}/api/notifications/not-a-valid-id/read",
            headers=auth_headers,
        )
        assert r.status_code == 400, r.text


# ==================== End-to-end kiosk-to-queue flow ====================
class TestKioskToQueueE2E:
    @pytest.fixture
    def setup(self, api_client):
        # Fresh seed
        r = api_client.post(f"{BASE_URL}/api/seed")
        assert r.status_code == 200
        faculty_id = "FAC2024005"  # no seeded queue for a clean slate

        # 1) Kiosk submits a request
        payload = {
            "faculty_school_id": faculty_id,
            "topic": "TEST_e2e_flow",
            "consultation_type": "individual",
            "students": [{
                "student_id": "STU2024101",
                "full_name": "John Dela Cruz",
                "year_level": "4th Year",
                "section": "BSCS-4A",
            }],
        }
        rk = api_client.post(f"{BASE_URL}/api/kiosk/consultation-request", json=payload)
        assert rk.status_code == 200, rk.text
        kiosk_body = rk.json()
        queue_id = kiosk_body["queue_id"]
        queue_number = kiosk_body["queue_number"]

        # Login faculty
        rl = api_client.post(f"{BASE_URL}/api/auth/login",
                             json={"school_id": faculty_id, "password": "password123"})
        assert rl.status_code == 200
        headers = {"Authorization": f"Bearer {rl.json()['access_token']}",
                   "Content-Type": "application/json"}
        return {
            "faculty_id": faculty_id,
            "headers": headers,
            "queue_id": queue_id,
            "queue_number": queue_number,
        }

    def test_kiosk_request_has_queue_fields(self, api_client, setup):
        # The consultation_request created should carry queue_id + queue_number
        headers = setup["headers"]
        rr = api_client.get(
            f"{BASE_URL}/api/consultation-requests?status=pending", headers=headers)
        assert rr.status_code == 200
        pending = [x for x in rr.json() if x.get("topic") == "TEST_e2e_flow"]
        assert pending, "no pending kiosk request found"
        req = pending[0]
        assert req.get("queue_id") == setup["queue_id"]
        assert req.get("queue_number") == setup["queue_number"]

    def test_accept_copies_queue_fields_to_consultation(self, api_client, setup):
        headers = setup["headers"]
        # Find + accept the request
        rr = api_client.get(
            f"{BASE_URL}/api/consultation-requests?status=pending", headers=headers)
        pending = [x for x in rr.json() if x.get("topic") == "TEST_e2e_flow"]
        req_id = pending[0]["_id"]
        ra = api_client.post(
            f"{BASE_URL}/api/consultation-requests/{req_id}/action",
            json={"action": "accept"}, headers=headers,
        )
        assert ra.status_code == 200, ra.text

        # The created consultation should have queue_id/queue_number/consultation_type
        rc = api_client.get(
            f"{BASE_URL}/api/consultations?status=scheduled", headers=headers)
        assert rc.status_code == 200
        matches = [c for c in rc.json() if c.get("topic") == "TEST_e2e_flow"]
        assert matches, "consultation not found after accept"
        c = matches[0]
        assert c.get("queue_id") == setup["queue_id"], f"queue_id not copied: {c}"
        assert c.get("queue_number") == setup["queue_number"]
        assert c.get("consultation_type") == "individual"

    def test_full_flow_start_complete_updates_queue_and_faculty(self, api_client, setup):
        headers = setup["headers"]
        faculty_id = setup["faculty_id"]

        # Accept
        rr = api_client.get(
            f"{BASE_URL}/api/consultation-requests?status=pending", headers=headers)
        pending = [x for x in rr.json() if x.get("topic") == "TEST_e2e_flow"]
        req_id = pending[0]["_id"]
        ra = api_client.post(
            f"{BASE_URL}/api/consultation-requests/{req_id}/action",
            json={"action": "accept"}, headers=headers,
        )
        assert ra.status_code == 200

        # Grab consultation
        rc = api_client.get(
            f"{BASE_URL}/api/consultations?status=scheduled", headers=headers)
        cid = [c for c in rc.json() if c.get("topic") == "TEST_e2e_flow"][0]["_id"]

        # Start -> queue should flip to serving; faculty busy
        rs = api_client.post(f"{BASE_URL}/api/consultations/{cid}/start", headers=headers)
        assert rs.status_code == 200, rs.text

        # Verify via TV display (public) that now_serving is the kiosk entry
        rtv = api_client.get(f"{BASE_URL}/api/tv-display/status")
        assert rtv.status_code == 200
        fac = next(x for x in rtv.json() if x["school_id"] == faculty_id)
        assert fac["now_serving"] is not None, f"now_serving should be set: {fac}"
        assert fac["now_serving"]["queue_number"] == setup["queue_number"]

        # Faculty is busy
        rp = api_client.get(f"{BASE_URL}/api/faculty/profile", headers=headers)
        assert rp.json()["availability_status"] == "busy"

        # Complete -> queue should flip to completed; faculty back to available
        rcp = api_client.post(f"{BASE_URL}/api/consultations/{cid}/complete",
                              headers=headers)
        assert rcp.status_code == 200, rcp.text

        # Faculty back to available
        rp2 = api_client.get(f"{BASE_URL}/api/faculty/profile", headers=headers)
        assert rp2.json()["availability_status"] == "available"

        # TV display: now_serving cleared for this faculty (queue entry not waiting/serving)
        rtv2 = api_client.get(f"{BASE_URL}/api/tv-display/status")
        fac2 = next(x for x in rtv2.json() if x["school_id"] == faculty_id)
        assert fac2["now_serving"] is None, f"now_serving should clear: {fac2}"
        assert fac2["waiting_count"] == 0


# ==================== Decline of kiosk request cancels queue entry ====================
class TestDeclineCancelsQueue:
    def test_decline_kiosk_request_cancels_queue(self, api_client):
        # Fresh state
        api_client.post(f"{BASE_URL}/api/seed")
        faculty_id = "FAC2024005"

        rk = api_client.post(
            f"{BASE_URL}/api/kiosk/consultation-request",
            json={
                "faculty_school_id": faculty_id,
                "topic": "TEST_decline_flow",
                "consultation_type": "individual",
                "students": [{"student_id": "STU2024101",
                              "full_name": "John Dela Cruz",
                              "year_level": "4th Year", "section": "BSCS-4A"}],
            },
        )
        assert rk.status_code == 200
        queue_number = rk.json()["queue_number"]

        # Queue should have 1 waiting
        rq = api_client.get(f"{BASE_URL}/api/kiosk/queue/{faculty_id}")
        assert rq.status_code == 200
        assert len(rq.json()) == 1
        assert rq.json()[0]["status"] == "waiting"
        assert rq.json()[0]["queue_number"] == queue_number

        # Login faculty & decline
        rl = api_client.post(f"{BASE_URL}/api/auth/login",
                             json={"school_id": faculty_id, "password": "password123"})
        headers = {"Authorization": f"Bearer {rl.json()['access_token']}",
                   "Content-Type": "application/json"}
        rr = api_client.get(
            f"{BASE_URL}/api/consultation-requests?status=pending", headers=headers)
        req_id = [x for x in rr.json()
                  if x.get("topic") == "TEST_decline_flow"][0]["_id"]

        rd = api_client.post(
            f"{BASE_URL}/api/consultation-requests/{req_id}/action",
            json={"action": "decline", "reason": "TEST_reason"}, headers=headers,
        )
        assert rd.status_code == 200

        # Queue endpoint returns waiting only -> should now be empty
        rq2 = api_client.get(f"{BASE_URL}/api/kiosk/queue/{faculty_id}")
        assert rq2.status_code == 200
        assert rq2.json() == [], f"expected empty waiting queue, got {rq2.json()}"
