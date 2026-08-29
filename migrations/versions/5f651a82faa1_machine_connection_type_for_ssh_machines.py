"""machine connection_type for ssh machines

Revision ID: 5f651a82faa1
Revises: 1eaa4dad943f
Create Date: 2026-08-30 03:13:12.043849

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5f651a82faa1'
down_revision: Union[str, None] = '1eaa4dad943f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Server default keeps existing agent machines valid without a rewrite.
    op.add_column(
        'machines',
        sa.Column(
            'connection_type',
            sa.String(length=16),
            nullable=False,
            server_default='agent',
        ),
    )


def downgrade() -> None:
    op.drop_column('machines', 'connection_type')
