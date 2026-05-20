import click


@click.group()
@click.version_option()
def main():
    """Confluence Sync — synkroniser Confluence til lokalt Markdown."""
    pass
