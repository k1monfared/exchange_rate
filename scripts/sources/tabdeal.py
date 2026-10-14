from sources.base import Source


class Tabdeal(Source):
    source_id = "tabdeal"

    def url(self) -> str:
        raise NotImplementedError

    def parse(self, payload) -> list:
        raise NotImplementedError
