const config = require('./config.json');
const superagent = require('superagent');
const { MessageEmbed } = require('discord.js');

const minimumRobuxProfit = config['minimum robux profit'];
const blacklist = config.blacklist.map(i => Number(i));
const webhookUrl = config['webhook'];

const currentUser = {
    username: 'ROBLOX',
    id: 1,
};
let csrf = 'aabbcc';

let ollieData = {};
let projecteds = {};

let minimums = {};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sendEmbed = embed => 
    superagent('POST', webhookUrl)
    .set('content-type', 'application/json')
    .send({
        embeds: [embed.toJSON()]
    })
    .end();

const refreshOllieDetails = () => new Promise(resolve => {
    superagent('GET', 'https://ollie.fund/api/itemdetails')
        .then(resp => {
            if (!resp.body || !Object.keys(resp.body).length) return resolve();
            ollieData = resp.body;
            return resolve();
        })
        .catch(async err => {
            console.log(err.response ? err.response.text : err);
            print(`failed to fetch details from ollie.fund`);
            await sleep(5 * 1000);
            return resolve(await refreshOllieDetails());
        })
})
const refreshProjectedsDetails = () => new Promise(resolve => {
    superagent('GET', 'https://projecteds.quaid.mx')
        .then(resp => {
            if (!resp.body || !Object.keys(resp.body).length) return resolve();
            projecteds = resp.body;
            return resolve();
        })
        .catch(async err => {
            console.log(err.response ? err.response.text : err);
            print(`failed to fetch details from quaid.mx`);
            await sleep(5 * 1000);
            return resolve(await refreshProjectedsDetails());
        })
})
const refreshItems = async () => {
    const promises = [
        refreshOllieDetails(),
        refreshProjectedsDetails(),
    ]
    await Promise.all(promises);
}

const agent = superagent.agent()
    .set('cookie', `.ROBLOSECURITY=${config.cookie}`)

const print = (str) => {
    console.log(`[${new Date().toLocaleString()}] ${str}`);
}

const validateCookie = async () => new Promise(resolve => {
    agent.get('https://www.roblox.com/my/settings/json')
        .then(resp => {
            if (!resp.body || !Object.keys(resp.body).length)
                return resolve(false);

            currentUser.username = resp.body.Name;
            currentUser.id = resp.body.UserId;

            return resolve(true);
        })
        .catch(err => {
            console.error(err.response ? err.response.text : err);
            return resolve(false);
        })
})
const listForSale = async (itemId, uaid, price) => new Promise(resolve => {
    agent.patch(`https://economy.roblox.com/v1/assets/${itemId}/resellable-copies/${uaid}`)
        .set('x-csrf-token', csrf)
        .send({
            price
        })
        .then(resp => resolve(true))
        .catch(async err => {
            if (!err.response) {
                console.error(err);
                console.error(`failed to list ${itemId} for sale due to request error`);
                return resolve(false);
            }

            const text = err.response.text;
            if (text.includes('Token Validation Failed')) {
                csrf = err.response.headers['x-csrf-token'];
                return resolve(await listForSale(itemId, uaid, price));
            }

            if (text.includes('TooManyRequests')) {
                console.error(`failed to list ${itemId} for sale due to too many requests`);
                await sleep(5 * 1000);
                return resolve(await listForSale(itemId, uaid, price));
            }

            print(text);
            return resolve(false);
        })
})
const fetchResellers = async (itemId) => new Promise(resolve => {
    agent.get(`https://economy.roblox.com/v1/assets/${itemId}/resellers?limit=100`)
        .then(resp => {
            if (!resp.body || !resp.body.data || !resp.body.data.length)
                return resolve([]);
            return resolve(resp.body.data);
        })
        .catch(async err => {
            if (!err.response) {
                console.error(err);
                print(`failed to fetch resellers for ${itemId} due to request error`);
                return resolve([]);
            }

            const text = err.response.text;
            if (text.includes('TooManyRequests')) {
                print(`failed to fetch resellers for ${itemId} due to too many requests`);
                await sleep(5 * 1000);
                return resolve(await fetchResellers(itemId));
            }

            console.error(text);
            print(`failed to fetch resellers for ${itemId}`);
            return resolve([]);
        })
})
const fetchPastPurchases = async (cursor, sales = []) => new Promise(resolve => {
    let url = `https://economy.roblox.com/v2/users/${currentUser.id}/transactions?limit=100&transactionType=Purchase`;
    if (cursor) url += `&cursor=${cursor}`;

    agent.get(url)
        .then(resp => {
            if (!resp.body || !resp.body.data || !resp.body.data.length)
                return resolve(sales);

            sales.push(...resp.body.data);
            if (resp.body.nextPageCursor && sales.length < 1000)
                return resolve(fetchPastPurchases(resp.body.nextPageCursor, sales));
            else
                return resolve(sales);
        })
        .catch(err => {
            if (!err.response) {
                console.error(err);
                print('failed to fetch past purchases due to request error');
                return resolve(sales);
            }

            console.error(err);
            print('failed to fetch past purchases');
            return resolve(sales);
        })
})
const fetchInventory = async (cursor, data = []) => new Promise(resolve => {
    let url = `https://inventory.roblox.com/v1/users/${currentUser.id}/assets/collectibles?limit=100`;
    if (cursor) url += `&cursor=${cursor}`;

    agent.get(url)
        .then(resp => {
            if (!resp.body || !resp.body.data || !resp.body.data.length)
                return resolve(data);

            data.push(...resp.body.data);
            if (resp.body.nextPageCursor)
                return resolve(fetchInventory(resp.body.nextPageCursor, data));
            else
                return resolve(data);
        })
        .catch(err => {
            if (!err.response) {
                console.error(err);
                print('failed to fetch inventory due to request error');
                return resolve(data);
            }

            console.error(err);
            print('failed to fetch inventory');
            return resolve(data);
        })
})

const main = async () => {
    const valid = await validateCookie();
    if (!valid) {
        print(`invalid cookie!!`);
        return process.exit();
    }

    print(`authorized as ${currentUser.username} (${currentUser.id})`);

    print(`fetching item details...`);
    await refreshItems();
    setInterval(refreshItems, 60 * 1000);

    print(`fetching past purchases...`);
    const pastPurchases = await fetchPastPurchases();

    for (const purchase of pastPurchases) {
        const item = purchase.details;
        if (!item.type || item.type !== 'Asset') continue;
        const id = item.id;
        const price = Math.abs(purchase.currency.amount)
        const date = new Date(purchase.created);
        if (date < new Date('August 2022').getTime()) continue;

        if (!ollieData[id] || !projecteds[id]) continue;
        const minimumSalePrice = Math.floor((price + minimumRobuxProfit) / 0.7);

        if (!minimums[id] || minimums[id] < minimumSalePrice)
            minimums[id] = minimumSalePrice;
    }

    for (;;) {
        print(`fetching inventory...`);
        const inventory = await fetchInventory();

        let idSortedInventory = {};
        for (const asset of inventory) {
            const id = asset.assetId;
            const uaid = asset.userAssetId;

            if (blacklist.includes(id)) continue;

            if (!idSortedInventory[id])
                idSortedInventory[id] = [];
            idSortedInventory[id].push(uaid);
        }

        for (const itemId in idSortedInventory) {
            const ollieDetails = ollieData[itemId];
            const projectedDetails = projecteds[itemId];
            const uaids = idSortedInventory[itemId];
            const value = Math.min(projectedDetails.rap, projectedDetails.adjustedRap)
            const priceMinimum = minimums[itemId] || value;
            const resellers = await fetchResellers(itemId);
            const otherSellers = resellers.filter(reseller => reseller.seller.id !== currentUser.id);
            if (!otherSellers.length) continue;

            const lowestReseller = otherSellers[0];
            const resellerPrice = lowestReseller.price;
            const resellerUaid = lowestReseller.userAssetId;

            for (const uaid of uaids) {
                const listingPrice = resellerPrice > priceMinimum ?
                    resellerUaid > uaid ? resellerPrice : resellerPrice - 1 : priceMinimum

                print(`Listing ${ollieDetails.name} (uaid: ${uaid}) for ${listingPrice.toLocaleString()} robux (minimum ${priceMinimum.toLocaleString()})`);
                const listed = await listForSale(itemId, uaid, listingPrice);
                if (listed) sendEmbed(
                    new MessageEmbed()
                    .setColor('ORANGE')
                    .setTitle(`📋 Listed ${ollieDetails.name}`)
                    .setDescription(
                        `:dollar: **price**: \`${listingPrice.toLocaleString()}\`\n` +
                        `:euro: **value**: \`${(ollieDetails.value || ollieDetails.rap).toLocaleString()}\`\n` +
                        `:grin: **minimum**: \`${priceMinimum.toLocaleString()}\`\n` +
                        `📄 **uaid**: \`${uaid}\``
                    )
                    .setURL(`https://www.roblox.com/catalog/${itemId}`)
                    .setThumbnail(ollieDetails.thumbnailUrl)
                )
            }

            await sleep(3 * 1000)
        }
    }
}

main();