from sources.base import Source


class Nerkhsanj(Source):
    source_id = "nerkhsanj"

    def url(self) -> str:
        raise NotImplementedError

    def parse(self, payload) -> list:
        raise NotImplementedError
