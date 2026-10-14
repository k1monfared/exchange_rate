from sources.base import Source


class GlobalFx(Source):
    source_id = "globalfx"

    def url(self) -> str:
        raise NotImplementedError

    def parse(self, payload) -> list:
        raise NotImplementedError
