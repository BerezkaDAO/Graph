import { Address, BigDecimal } from "@graphprotocol/graph-ts"
import { Transfer } from "../generated/Contract/ERC20"
import { CurrentHistoricalBalance, HistoricalBalance, BalanceEvent } from "../generated/schema"

const DEPOSIT : u16 = 1
const WITHDRAW: u16 = 2

export function tokenTransferred(event: Transfer): void {
    let token = event.address
    let timestamp = event.block.timestamp.toI32()

    let sender = event.params._from
    let recipient = event.params._to
    let amount = event.params._value.toBigDecimal()

    let currentRecipientBalanceID = token.toHexString().concat('_').concat(recipient.toHexString())
    let currentSenderBalanceID = token.toHexString().concat('_').concat(sender.toHexString())

    // Load current balances
    //
    let currentRecipientBalance = CurrentHistoricalBalance.load(currentRecipientBalanceID)
    if (currentRecipientBalance == null) {
        createBalance(
            currentRecipientBalanceID,
            recipient,
            token,
            zeroBD()
        )
        currentRecipientBalance = CurrentHistoricalBalance.load(currentRecipientBalanceID)!!
    }

    let currentSenderBalance = CurrentHistoricalBalance.load(currentSenderBalanceID)
    if (currentSenderBalance == null) {
        createBalance(
            currentSenderBalanceID,
            sender,
            token,
            zeroBD()
        )
        currentSenderBalance = CurrentHistoricalBalance.load(currentSenderBalanceID)!!
    }

    // Update current balances
    //
    currentSenderBalance.amount = currentSenderBalance.amount.minus(amount)
    currentRecipientBalance.amount = currentRecipientBalance.amount.plus(amount)
    currentSenderBalance.save()
    currentRecipientBalance.save()

    // Create balance snapshots
    //
    createBalanceSnapshot(
        timestamp,
        sender,
        token,
        currentSenderBalance.amount
    )

    createBalanceSnapshot(
        timestamp,
        recipient,
        token,
        currentRecipientBalance.amount
    )

    // Create events
    //
    createEvent(timestamp, sender, recipient, token, amount, WITHDRAW)
    createEvent(timestamp, recipient, sender, token, amount, DEPOSIT)
}

function createBalance(
    balanceID: string, 
    wallet: Address,
    token: Address,
    amount: BigDecimal
): void
{
    let balance = new CurrentHistoricalBalance(balanceID)
    balance.token = token
    balance.amount = amount
    balance.wallet = wallet
    balance.save()
}

function createBalanceSnapshot(
    timestamp: i32,
    wallet: Address, 
    token: Address,
    amount: BigDecimal
): void
{
    let balanceID = timestamp.toString()
        .concat('_')
        .concat(wallet.toHexString())
        .concat('_')
        .concat(token.toHexString())


    let balance = new HistoricalBalance(balanceID)
    let dayID = timestamp / 86400
    let hourID = timestamp / 3600

    balance.dayId = dayID
    balance.hourId = hourID
    balance.date = timestamp
    balance.wallet = wallet
    balance.token = token
    balance.amount = amount
    balance.save()
}

function createEvent(
    timestamp: i32,
    wallet: Address,
    counterparty: Address,
    token: Address,
    amount: BigDecimal,
    type: u16
): void
{
    let eventID = timestamp.toString()
        .concat('_')
        .concat(wallet.toHexString())
        .concat('_')
        .concat(token.toHexString())


    let event = new BalanceEvent(eventID)
    let dayID = timestamp / 86400
    let hourID = timestamp / 3600

    event.dayId = dayID
    event.hourId = hourID
    event.date = timestamp
    event.wallet = wallet
    event.counterparty = counterparty
    event.token = token
    event.amount = amount
    event.kind = type
    event.save()
}

export function zeroBD(): BigDecimal {
    return BigDecimal.fromString('0')
}