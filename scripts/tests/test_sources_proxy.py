from sources.tetherland import Tetherland
from sources.nobitex import Nobitex
from sources.ramzinex import Ramzinex
from sources.wallex import Wallex
from sources.tabdeal import Tabdeal
from sources.bitpin import Bitpin


def test_tetherland_toman_two_sided():
    p = {"status": 200, "data": {"currencies": {"USDT": {"price": 258900, "sell_price": 259100, "buy_price": 258700}}}}
    r = Tetherland().parse(p)[0]
    assert r.kind == "proxy"
    assert r.buy_rial == 2587000 and r.sell_rial == 2591000


def test_nobitex_rial_two_sided():
    p = {"status": "ok", "stats": {"usdt-rls": {"bestBuy": "2600990", "bestSell": "2601040"}}}
    r = Nobitex().parse(p)[0]
    assert r.buy_rial == 2600990 and r.sell_rial == 2601040


def test_ramzinex_orderbook_rial():
    p = {"data": {"buys": [[2585000, 1], [2584350, 2]], "sells": [[2615000, 1]]}}
    r = Ramzinex().parse(p)[0]
    assert r.buy_rial == 2585000 and r.sell_rial == 2615000


def test_wallex_toman_bid_ask():
    p = {"result": {"symbols": {"USDTTMN": {"stats": {"bidPrice": "257046.0", "askPrice": "257620.0"}}}}}
    r = Wallex().parse(p)[0]
    assert r.buy_rial == 2570460 and r.sell_rial == 2576200


def test_tabdeal_toman_bids_asks():
    p = {"asks": [["260310.0", "5"], ["260340.0", "1"]], "bids": [["260200.0", "3"]]}
    r = Tabdeal().parse(p)[0]
    assert r.buy_rial == 2602000 and r.sell_rial == 2603100


def test_bitpin_single_sided_toman():
    p = {"results": [{"code": "USDT_IRT", "price": "257007", "order_book_info": {"price": "257007"}}]}
    r = Bitpin().parse(p)[0]
    assert r.price_rial == 2570070
    assert r.single_sided is True
    assert r.kind == "proxy"
