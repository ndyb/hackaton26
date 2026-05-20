import hashlib
from datetime import datetime, timezone
from pathlib import Path

from confluence_sync.api import ConfluenceClient
from confluence_sync.converter import storage_to_markdown
from confluence_sync.frontmatter import write_frontmatter
from confluence_sync.models import PageMeta, SyncState
from confluence_sync.tree import build_page_tree, build_file_path


def _traverse_tree(
    nodes: list[dict],
    parent_path: Path,
    space_key: str,
    state: SyncState,
    count: int,
) -> int:
    """Recursively traverse the page tree, writing markdown files and updating sync state."""
    for node in nodes:
        page = node["page"]
        children = node["children"]
        has_children = len(children) > 0

        filepath = build_file_path(page, parent_path, has_children)

        storage_value = page["body"]["storage"]["value"]
        markdown_body = storage_to_markdown(storage_value)

        content_hash = hashlib.sha256(markdown_body.encode()).hexdigest()

        meta = PageMeta(
            confluence_id=page["id"],
            space_key=space_key,
            title=page["title"],
            version=page["version"]["number"],
            parent_id=page.get("parentId"),
            last_synced=datetime.now(timezone.utc).isoformat(),
            content_hash=content_hash,
        )

        write_frontmatter(filepath, meta, markdown_body)

        state.pages[page["id"]] = meta.to_dict()
        count += 1

        if has_children:
            child_parent_path = filepath.parent
            count = _traverse_tree(children, child_parent_path, space_key, state, count)

    return count


def pull_space(space_key: str, output_dir: Path, client: ConfluenceClient) -> int:
    """Pull all pages from a Confluence space and save as local Markdown files.

    Returns the number of pages synced.
    """
    pages = client.get_space_pages(space_key)
    tree = build_page_tree(pages)

    state = SyncState(
        instance_url=client.base_url,
        space_key=space_key,
        last_full_sync=datetime.now(timezone.utc).isoformat(),
    )

    count = _traverse_tree(tree["roots"], output_dir, space_key, state, 0)

    state.save(output_dir)
    return count
