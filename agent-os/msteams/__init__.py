"""Vendored copy of the Microsoft Teams interface (PR #9307 on agno-agi/agno).

Kept local until the PR merges upstream — then swap the imports back to
`from agno.os.interfaces.teams import MicrosoftTeams` and delete this folder.
"""
from .teams import MicrosoftTeams

__all__ = ["MicrosoftTeams"]

