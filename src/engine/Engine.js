const _ = require('lodash');
const rh = require('../services/rbhApiService');
const Utils = require('../utils');
const TOKEN_REFRESH_INTERVAL = 18000000; // 5h
const REFRESH_INTERVAL = 10000; // 1m
const rule = {
  currency_code: 'BTC',
  portfolioDiversity: 1,
  stopLossPerc: 1,
};


class Engine {
  constructor() {
    this.currencyPair = null;
    this.limitBuyPrice = null;
    this.limitSellPrice = null;
  }

  async start() {
    try {
      await rh.auth();
      this.currencyPair = await rh.getCurrencyPairs(rule.currency_code);
      this.processFeeds();

      // Refresh token and process feeds every 5 hours and 10 secs respectively
      setInterval(() => rh.auth(), TOKEN_REFRESH_INTERVAL);
      setInterval(async () => this.processFeeds(), REFRESH_INTERVAL);
    } catch (error) {
      console.error(error);
    }
  }

  async processFeeds() {
    try {
      const [account, cryptoAccount, holdings, updatedCurrencyPair, orders, historicals, quote] = await Promise.all([
        rh.getAccount(),
        rh.getCryptoAccount(),
        rh.getHoldings(),
        rh.getCurrencyPairs(rule.currency_code),
        rh.getOrders(),
        rh.getHistoricals(this.currencyPair.id),
        rh.getQuote(this.currencyPair.id)
      ]);
      this.currencyPair = updatedCurrencyPair;
      const holding = holdings.find(({ currency }) => currency.code === rule.currency_code);
      const usdBalanceAvailable = Number(account.sma);
      const investedCurrencyBalance = Number(_.get(holding, 'quantity', 0));
      const currentPrice = Number(quote.mark_price || 0);
      const lastOrder = orders.length && orders[0];
      const account_id = _.get(lastOrder || holding, 'account_id');

      // Purchase pattern, todo: uncomment below
      if (usdBalanceAvailable && !investedCurrencyBalance /*&& Utils.calculateRSI(historicals) <= 30*/) {
        // If limit price not set or above current price, update it
        if (!this.limitBuyPrice || this.limitBuyPrice > currentPrice) {
          this.limitBuyPrice = currentPrice;
        }
        // If current price went above the limit price it is time to buy
        else if (this.limitBuyPrice <= currentPrice) {
          // Cancel any pending order
          if (lastOrder.cancel_url) {
            await rh.postWithAuth(lastOrder.cancel_url);
          }

          /**
           * TODO: Getting the below error. Log into RB and compare request params
           * 400 - {"price":["Order price has invalid increment."]}
           * @type {string}
           */
          const price = (Number(quote.mark_price) * 0.998).toString();

          // Try buying here
          const order = await rh.placeOrder({
            account_id,
            currency_pair_id: this.currencyPair.id,
            price: price,
            quantity: Utils.calculateCurrencyAmount(price, account.sma, rule.portfolioDiversity),
            ref_id: cryptoAccount.id,
            side: 'buy',
            time_in_force: 'gtc',
            type: 'limit'
          });

          console.log(order);
        }
      }
      // Sell pattern todo: finish here
      else if (investedCurrencyBalance) {
        // Stop loss execution realized gain is less than 1%
        const realizedGainPerc = 100 * (investedCurrencyBalance / Number(lastOrder.quantity));// todo revisit so that
        if (realizedGainPerc < -1) {
          // Sell immediate
          await rh.placeOrder({
            account_id,
            currency_pair_id: this.currencyPair.id,
            price: quote.mark_price,
            quantity: holding.quantity,
            ref_id: cryptoAccount.id,
            side: 'sell',
            time_in_force: 'gtc',
            type: 'limit'
          });
        } else if (realizedGainPerc > 1) {
          // Set limitSell limit

        }
      }
    } catch (e) {
      console.error(e.message);
    }
  }
}

module.exports = Engine;