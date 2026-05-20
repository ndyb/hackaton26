import requests


class ConfluenceClient:
    def __init__(self, instance_url: str, email: str, api_token: str):
        self.base_url = f"https://{instance_url}/wiki/api/v2"
        self.origin = f"https://{instance_url}"
        self.session = requests.Session()
        self.session.auth = (email, api_token)
        self.session.headers.update({
            "Accept": "application/json",
            "Content-Type": "application/json",
        })

    def get_space_pages(self, space_key: str) -> list[dict]:
        resp = self.session.get(f"{self.base_url}/spaces", params={"keys": space_key})
        resp.raise_for_status()
        results = resp.json().get("results", [])
        if not results:
            return []
        space_id = results[0]["id"]
        page_summaries = self._get_paginated(
            f"{self.base_url}/spaces/{space_id}/pages",
        )
        return [self.get_page(summary["id"]) for summary in page_summaries]

    def get_page(self, page_id: str) -> dict:
        resp = self.session.get(
            f"{self.base_url}/pages/{page_id}",
            params={"body-format": "storage"},
        )
        resp.raise_for_status()
        return resp.json()

    def get_page_children(self, page_id: str) -> list[dict]:
        return self._get_paginated(f"{self.base_url}/pages/{page_id}/children")

    def update_page(self, page_id: str, title: str, body: str, version: int) -> dict:
        resp = self.session.put(
            f"{self.base_url}/pages/{page_id}",
            json={
                "id": page_id,
                "status": "current",
                "title": title,
                "body": {"representation": "storage", "value": body},
                "version": {"number": version, "message": "Updated via confluence-sync"},
            },
        )
        resp.raise_for_status()
        return resp.json()

    def _get_paginated(self, url: str, params: dict = None) -> list[dict]:
        items = []
        next_url = url
        first = True
        while next_url:
            if first:
                resp = self.session.get(next_url, params=params)
                first = False
            else:
                resp = self.session.get(next_url)
            resp.raise_for_status()
            data = resp.json()
            items.extend(data.get("results", []))
            next_link = data.get("_links", {}).get("next")
            if next_link and not next_link.startswith("http"):
                next_link = self.origin + next_link
            next_url = next_link
        return items
