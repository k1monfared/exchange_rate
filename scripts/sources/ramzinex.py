from sources.base import Source


class Ramzinex(Source):
    source_id = "ramzinex"

    def url(self) -> str:
        raise NotImplementedError

    def parse(self, payload) -> list:
        raise NotImplementedError
