from sources.base import Source


class Tetherland(Source):
    source_id = "tetherland"

    def url(self) -> str:
        raise NotImplementedError

    def parse(self, payload) -> list:
        raise NotImplementedError
