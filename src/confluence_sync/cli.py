from pathlib import Path

import click
import requests
from rich.console import Console

from confluence_sync.api import ConfluenceClient
from confluence_sync.auth import load_config, save_config, validate_credentials
from confluence_sync.sync import pull_space

console = Console()


@click.group()
@click.version_option()
def main():
    """Confluence Sync — synkroniser Confluence til lokalt Markdown."""
    pass


@main.command()
def auth():
    """Koble til Confluence Cloud med API-token."""
    console.print(
        "\nOpprett API-token her: [link]https://id.atlassian.com/manage-profile/security/api-tokens[/link]\n"
    )

    instance_url = click.prompt("Atlassian Cloud URL (f.eks. mycompany.atlassian.net)")
    instance_url = instance_url.removeprefix("https://").removeprefix("http://").rstrip("/")

    email = click.prompt("E-post")
    api_token = click.prompt("API-token", hide_input=True)

    console.print("Verifiserer tilkobling...", style="dim")

    try:
        display_name = validate_credentials(instance_url, email, api_token)
    except Exception as e:
        console.print(f"[red]Feil:[/red] {e}")
        raise SystemExit(1)

    save_config(instance_url, email, api_token)
    console.print(f"[green]Logget inn som {display_name}. Credentials lagret.[/green]")


@main.command()
@click.option("--space", required=True, help="Confluence space key")
@click.option("--output", default=".", help="Output directory")
@click.option("--page-id", default=None, help="Sync specific page and children")
def pull(space, output, page_id):
    """Hent sider fra Confluence og lagre som Markdown."""
    try:
        config = load_config()
    except FileNotFoundError as e:
        console.print(f"[red]Feil:[/red] {e}")
        raise SystemExit(1)

    client = ConfluenceClient(
        instance_url=config["instance_url"],
        email=config["email"],
        api_token=config["api_token"],
    )

    console.print(f"Henter sider fra space [bold]{space}[/bold]...")

    try:
        count = pull_space(space, Path(output), client)
    except requests.RequestException as e:
        console.print(f"[red]Feil ved henting fra Confluence:[/red] {e}")
        raise SystemExit(1)

    console.print(f"[green]Ferdig! {count} sider synkronisert.[/green]")
