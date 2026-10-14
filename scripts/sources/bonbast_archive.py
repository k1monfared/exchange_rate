from sources.base import Source


class BonbastArchive(Source):
    source_id = "bonbast_archive"

    def url(self) -> str:
        raise NotImplementedError

    def parse(self, payload) -> list:
        raise NotImplementedError
