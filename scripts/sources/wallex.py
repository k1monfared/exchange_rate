from sources.base import Source


class Wallex(Source):
    source_id = "wallex"

    def url(self) -> str:
        raise NotImplementedError

    def parse(self, payload) -> list:
        raise NotImplementedError
