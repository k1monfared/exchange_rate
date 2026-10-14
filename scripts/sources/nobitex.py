from sources.base import Source


class Nobitex(Source):
    source_id = "nobitex"

    def url(self) -> str:
        raise NotImplementedError

    def parse(self, payload) -> list:
        raise NotImplementedError
