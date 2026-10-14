from __future__ import annotations

from abc import ABC, abstractmethod

from model import Record


class Source(ABC):
    source_id: str = ""
    kind: str = "exact"
    pair_from: str = ""
    pair_to: str = "IRR"

    @abstractmethod
    def url(self) -> str:
        ...

    @abstractmethod
    def parse(self, payload) -> list[Record]:
        ...
