import BlockchainAPI from "./BlockchainAPI";
import {Apis} from "bitsharesjs-ws";
import {
    PrivateKey,
    PublicKey,
    TransactionBuilder,
    Signature,
    FetchChain
} from "bitsharesjs";
import RendererLogger from "../RendererLogger";
const logger = new RendererLogger();

export default class BitShares extends BlockchainAPI {

    _connect(nodeToConnect = null) {
        return new Promise((resolve, reject) => {
            if (nodeToConnect == null) {
                nodeToConnect = this.getNodes()[0].url;
            }
            if (this._isConnected) {
                Apis.close().then(() => {
                    this._isConnected = false;
                    Apis.instance(
                        nodeToConnect,
                        true,
                        10000,
                        {enableCrypto: false, enableOrders: false},
                        this._connectionFailed.bind(null, nodeToConnect, "Connection closed")
                    ).init_promise.then(() => {
                        this._connectionEstablished(resolve, nodeToConnect);
                    }).catch(this._connectionFailed.bind(this, reject, nodeToConnect));
                });
            } else {
                Apis.instance(
                    nodeToConnect,
                    true,
                    10000,
                    {enableCrypto: false, enableOrders: false},
                    this._connectionFailed.bind(null, nodeToConnect, "Connection closed")
                ).init_promise.then(() => {
                    this._connectionEstablished(resolve, nodeToConnect);
                }).catch(this._connectionFailed.bind(this, reject, nodeToConnect));
            }
        });
    }

    getAccount(accountName) {
        return new Promise((resolve, reject) => {
            this.ensureConnection().then(() => {
                Apis.instance().db_api()
                    .exec("get_full_accounts", [[accountName], false])
                    .then(res => {
                        res[0][1].account.active.public_keys = res[0][1].account.active.key_auths;
                        res[0][1].account.owner.public_keys = res[0][1].account.owner.key_auths;
                        res[0][1].account.memo = {public_key: res[0][1].account.options.memo_key};
                        res[0][1].account.balances = res[0][1].balances;
                        resolve(res[0][1].account);
                    })
                    .catch((err) => {
                        reject(err);
                    });
            });
        });
    }

    resolveAsset(assetSymbolOrId) {
        return new Promise((resolve, reject) => {
            this.ensureConnection().then(() => {
                Apis.instance().db_api().exec("lookup_asset_symbols", [[assetName]]).then((asset_objects) => {
                    if (asset_objects.length && asset_objects[0]) {
                        resolve(asset_objects[0]);
                    }
                }).catch(reject);
            }).catch(reject);
        });
    }

    getAsset(assetSymbolOrId) {
        if (assetSymbolOrId == "1.3.0") {
            return {
                asset_id: "1.3.0",
                symbol: "BTS",
                precision: 5
            };
        } else if (assetSymbolOrId == "1.3.121") {
            return {
                asset_id: "1.3.121",
                symbol: "bitUSD",
                precision: 4
            };
        } else if (assetSymbolOrId == "1.3.113") {
            return {
                asset_id: "1.3.113",
                symbol: "bitCNY",
                precision: 4
            };
        } else if (assetSymbolOrId == "1.3.120") {
            return {
                asset_id: "1.3.120",
                symbol: "bitEUR",
                precision: 4
            };
        } else {
            return null;
        }
    }

    getBalances(accountName) {
        return new Promise((resolve, reject) => {
            this.ensureConnection().then(() => {
                this.getAccount(accountName).then((account) => {
                    let neededAssets = [];
                    for (let i = 0; i < account.balances.length; i++) {
                        neededAssets.push(account.balances[i].asset_type);
                    }
                    Apis.instance().db_api().exec("get_objects", [neededAssets]).then((assets) => {
                        let balances = [];
                        for (let i = 0; i < account.balances.length; i++) {
                            if (assets[i].issuer == "1.2.0") {
                                balances[i] = {
                                    asset_type: account.balances[i].asset_type,
                                    asset_name: assets[i].symbol,
                                    balance: account.balances[i].balance,
                                    owner: assets[i].issuer,
                                    prefix: "BIT"
                                };
                            } else {
                                balances[i] = {
                                    asset_type: account.balances[i].asset_type,
                                    asset_name: assets[i].symbol,
                                    rawbalance: account.balances[i].balance,
                                    balance: account.balances[i].balance /
                                        Math.pow(10, assets[i].precision),
                                    owner: assets[i].issuer,
                                    prefix: ""
                                };
                            }
                        }
                        resolve(balances);
                    });
                });
            });
        });
    }

    getPublicKey(privateKey) {
        return PrivateKey.fromWif(privateKey)
            .toPublicKey()
            .toString("BTS");
    }

    mapOperationData(incoming) {
        return new Promise((resolve, reject) => {
            this.ensureConnection().then(() => {
                if (incoming.action == "vote") {
                    let entity_id = incoming.params.id.split(".");
                    if (entity_id[0] != "1") {
                        reject("ID format unknown");
                    }
                    if (entity_id[1] != "5" && entity_id[1] != "6" && entity_id[1] != "14") {
                        reject("Given object does not support voting");
                    }
                    Apis.instance().db_api().exec(
                        "get_objects", [[incoming.params.id]]
                    ).then(objdata => {
                        switch (entity_id[1]) {
                            case "5":
                                Apis.instance().db_api().exec(
                                    "get_objects", [[objdata[0].committee_member_account]]
                                ).then(objextradata => {
                                    resolve({
                                        entity: "committee member",
                                        description:
                                            "Commitee member: " +
                                            objextradata[0].name +
                                            "\nCommittee Member ID: " +
                                            incoming.params.id,
                                        vote_id: objdata[0].vote_id
                                    });
                                }).catch(err => reject(err));
                                break;
                            case "6":
                                Apis.instance().db_api().exec(
                                    "get_objects", [[objdata[0].witness_account]]
                                ).then(objextradata => {
                                    resolve({
                                        entity: "witness",
                                        description:
                                            "Witness: " +
                                            objextradata[0].name +
                                            "\nWitness ID: " +
                                            incoming.params.id,
                                        vote_id: objdata[0].vote_id
                                    });
                                }).catch(err => reject(err));
                                break;
                            case "14":
                                Apis.instance().db_api().exec(
                                    "get_objects", [[objdata[0].worker_account]]
                                ).then(objextradata => {
                                    let dailyPay = objdata[0].daily_pay / Math.pow(10, 5);
                                    resolve({
                                        entity: "worker proposal",
                                        description:
                                            "Proposal: " +
                                            objdata[0].name +
                                            "\nProposal ID: " +
                                            incoming.params.id +
                                            "\nDaily Pay: " +
                                            dailyPay +
                                            "BTS\nWorker Account: " +
                                            objextradata[0].name,
                                        vote_id: objdata[0].vote_for
                                    });
                                }).catch(err => reject(err));
                                break;
                        }
                    }).catch(err => reject(err));
                }
            });
        });
    }

    sign(operation, key) {
        return new Promise((resolve, reject) => {
            this.ensureConnection().then(() => {
                if (operation.type) {
                    let tr = new TransactionBuilder();
                    tr.add_type_operation(
                        operation.type,
                        operation.data
                    );
                    tr.set_required_fees().then(() => {
                        let privateKey = PrivateKey.fromWif(key);
                        tr.add_signer(privateKey, privateKey.toPublicKey().toPublicKeyString());
                        resolve(tr);
                    }).catch(err => reject(err));
                } else {
                    if (typeof operation == "object"
                        && operation.length > 2
                        && operation[0] == "signAndBroadcast") {
                        let tr = new TransactionBuilder();
                        tr.ref_block_num = operation[1];
                        tr.ref_block_prefix = operation[2];
                        tr.expiration = operation[3];
                        operation[4].forEach(op => {
                            tr.add_operation(tr.get_type_operation(op[0], op[1]));
                        });
                        let privateKey = PrivateKey.fromWif(key);
                        Promise.all([
                            tr.set_required_fees(),
                            tr.update_head_block()
                        ]).then(() => {
                            tr.add_signer(privateKey, privateKey.toPublicKey().toPublicKeyString());
                            tr.finalize().then(() => {
                                tr.sign();
                                resolve(tr);
                            }).catch(reject);
                        });
                    } else {
                        reject("Unknown sign request");
                    }
                }
            }).catch(err => reject(err));
        });
    }

    broadcast(transaction) {
        return new Promise((resolve, reject) => {
            this.ensureConnection().then(() => {
                transaction.broadcast().then(id => {
                    resolve(id);
                }).catch(err => reject(err));
            }).catch(err => reject(err));
        });
    }

    getOperation(data, account) {
        let account_id = account.id;
        return new Promise((resolve, reject) => {
            this.ensureConnection().then(() => {
                let operation = {
                    type: null,
                    data: null
                };
                let api = Apis.instance();
                switch (data.action) {
                    case 'vote': {
                        operation.type = 'account_update';
                        api.db_api().exec(
                            "get_objects",
                            [[account_id]]
                        ).then((accounts) => {
                            let updateObject = {
                                account: account_id
                            };

                            let account = accounts[0];

                            let new_options = account.options;

                            if (new_options.votes.findIndex(item => item == data.vote_id) !== -1) {
                                resolve({
                                   vote_id: data.vote_id,
                                   notingToDo: true
                                });
                            }

                            new_options.votes.push(data.vote_id);
                            new_options.votes = new_options.votes.sort((a, b) => {
                                let a_split = a.split(":");
                                let b_split = b.split(":");
                                return (
                                    parseInt(a_split[1], 10) - parseInt(b_split[1], 10)
                                );
                            });
                            updateObject.new_options = new_options;
                            operation.data = updateObject;
                            resolve(operation);
                        }).catch(err => {
                            reject(err);
                        });

                    }
                    break;
                    default: {
                        operation.type = 'transfer';
                        operation.data = data;
                        resolve(operation);
                    }
                }
            });
        });
    }

    _signString(key, string) {
        let signature = Signature.signBuffer(
            string,
            PrivateKey.fromWif(key)
        );
        return signature.toHex();
    }

    _verifyString(signature, publicKey, string) {
        return Signature.fromHex(signature).verifyBuffer(
            string,
            PublicKey.fromPublicKeyString(publicKey)
        );
    }

    async transfer(key, from, to, amount, memo = null) {
        if (!amount.amount || !amount.asset_id) {
            throw "Amount must be a dict with amount and asset_id as keys"
        }
        from = await this.getAccount(from);
        to = await this.getAccount(to);
        let operation = {
            type: "transfer",
            data: {
                fee: {
                    amount: 0,
                    asset_id: "1.3.0"
                },
                from: from.id,
                to: to.id,
                amount: amount,
                memo: memo == null ? undefined : memo
            }
        };
        let transaction = await this.sign(operation, key);
        return await this.broadcast(transaction);
    }

    getExplorer(object) {
        if (object.accountName) {
            return "https://open-explorer.io/#/accounts/" + object.accountID;
        } else if (object.opid) {
            // 1.11.833380474
            return "https://open-explorer.io/#/operations/" + object.opid;
        } else if (object.txid) {
            // e94404a94b4bb160601241ffb78ad0e615a9636b
            return "https://bitsharescan.com/transaction/" + object.txid;
        } else {
            return false;
        }
    }

}
