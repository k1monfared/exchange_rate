from sources.base import Source


class Bitpin(Source):
    source_id = "bitpin"

    def url(self) -> str:
        raise NotImplementedError

    def parse(self, payload) -> list:
        raise NotImplementedError
