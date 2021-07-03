import { BigDecimal, Address, ethereum, BigInt, log, Bytes, ByteArray } from "@graphprotocol/graph-ts"
import { BerezkaPriceTracker } from "../generated/Contract/BerezkaPriceTracker"
import { StaklingGovernance } from  "../generated/Contract/StaklingGovernance"
import { BerezkaGovernance, BerezkaGovernance__listTokens1ResultValue0Struct } from "../generated/Contract/BerezkaGovernance"
import { ProtocolAdapter } from "../generated/Contract/ProtocolAdapter"
import { AdapterRegistry } from "../generated/Contract/AdapterRegistry"
import { EthBalance2 } from "../generated/Contract/EthBalance2"
import { ERC20 } from "../generated/Contract/ERC20"
import { DayHistoricalData, HourHistoricalData, DayTokenComponent, TokenComponent, TokenVault, TokenComponentPart } from "../generated/schema"

// Berezka price adapter address
const PRICE_API_ROOT = "0x2184FaE5a2e3355DF155AD3cDb2089F9f6e0868B"

// Berezka token addresses
const FLEX_TOKEN     = "0x0D7DeA5922535087078dd3D7c554EA9f2655d4cB"
const EFLX_TOKEN     = "0xD68E7b64888F095Ee15f18347ccA7e453E0DBe17"
const BDQ_TOKEN      = "0xf6ce9BFA82D1088d3257a76ec2e0ce1C8060BF8c"
const DYNA_TOKEN     = "0xdc76450fd7e6352733fe8550efabff750b2de0e3"
const SKYFLEX_TOKEN  = "0x26677EB24FD007Ad279FC55f367De31482E1bF54"
const ZERO_ADDRESS   = "0x0000000000000000000000000000000000000000"

// Lists of tokens
const GOVERNANCE     = "0xBC7166DEE7B0D157fa949d4b7c0Cc75982F3aE14"
const STAKING_GOV    = "0x8f8a4d60DC8Ce809cA5C37d71295cf1BC06db7C7"

// Zerion adapter registry
const REGISTRY       = "0x06FE76B2f432fdfEcAEf1a7d4f6C3d41B5861672"

// Eth token in Zerion
const ETH            = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"

// Contract, that allows us to query eth balance
const ETH_BALANCE    = "0x08A8fDBddc160A7d5b957256b903dCAb1aE512C5"
const ETH_BALANCE2   = "0xb1F8e55c7f64D203C1400B9D8555d050F94aDF39"

const INIT_BLOCK_NUMBER = 11179182

// For APY computations use different 

const DAYID_INIT_FLEX    = 18295
const DAYID_INIT_EFLX    = 18473
const DAYID_INIT_BDQ     = 18573
const DAYID_INIT_DYNA    = 18539
const DAYID_INIT_SKYFLEX = 18524

// How often we update our graph
//
const BLOCK_FREQ         = 300

// Global contracts
//
let governance = BerezkaGovernance.bind(Address.fromString(GOVERNANCE))
let staking    = StaklingGovernance.bind(Address.fromString(STAKING_GOV))
let registry = AdapterRegistry.bind(Address.fromString(REGISTRY))
let pricing  = BerezkaPriceTracker.bind(Address.fromString(PRICE_API_ROOT))
let ethBalance = EthBalance2.bind(Address.fromString(ETH_BALANCE2))

export function handleBlock(block: ethereum.Block): void {
    let blockNumber = block.number.toI32()
    if (blockNumber == INIT_BLOCK_NUMBER) {
        init()

        return;
    }

    // Speed up parsing by throwing away 49 blocks out of 50 
    // This indexes around ~10 blocks per hour
    // Which is more then enought
    //
    if (blockNumber % BLOCK_FREQ != 0) {
        return;
    }

    // Determine a list of tokens to process
    //
    let targetTokens = new Array<string>(1)
    targetTokens[0] = FLEX_TOKEN
    //targetTokens[1] = EFLX_TOKEN
    //targetTokens[2] = BDQ_TOKEN
    //targetTokens[3] = DYNA_TOKEN

    // Determine a list of high - level components for each token
    //
    for (let i = 0; i < targetTokens.length; i++) {
        handleTargetToken(
            Address.fromString(targetTokens[i]),
            block.timestamp.toI32()
        )
    }
}

function handleTargetToken(targetToken: Address, timestamp: i32): void {
    log.debug("Bound governance contracts addresses", [])

    let vaults = governance.getVaults(targetToken)
    log.debug("Got vaults size: {}", [strlen(vaults)])

    let assets = governance.listTokens1()
    let assetsLen = assets.length
    log.debug("Got assets size: {}", [assetsLen.toString()])

    let debtAdapters = governance.listProtocols()
    log.debug("Got debtAdapters size: {}", [strlen(debtAdapters)])

    let ethAdapters = governance.listEthProtocols()
    log.debug("Got ethAdapters size: {}", [strlen(ethAdapters)])

    let stakingAdapters = staking.listStakings()
    log.debug("Got stakingAdapters size: {}", [strlen(stakingAdapters)])

    let vaultIDs = new Array<string>(vaults.length)
    let totalPrice = BigInt.fromI32(0)
    for (let v = 0; v < vaults.length; v++) {
        let vault = handleTokenVault(
            timestamp,
            targetToken,
            vaults[v],
            assets,
            debtAdapters,
            ethAdapters,
            stakingAdapters
        )

        vaultIDs[v] = vault.id
        totalPrice = totalPrice.plus(vault.totalPrice)
        
        vault.save()
    }

    let tokenContract = ERC20.bind(targetToken)
    let name   = ""
    let maybeName = tokenContract.try_name()
    if (!maybeName.reverted) {
        name = maybeName.value
    }
    let supply = tokenContract.totalSupply()

    let totalPriceDec = totalPrice.toBigDecimal()
    let supplyDec = supply.toBigDecimal()
    let pricePowDec = BigInt.fromI32(10).pow(6).toBigDecimal()
    let supplyPowDec = BigInt.fromI32(10).pow(18).toBigDecimal()
    let adjTotalPrice = totalPriceDec.div(pricePowDec)
    let adjSupply = supplyDec.div(supplyPowDec)
    let adjPrice = adjTotalPrice.div(adjSupply)
    let priceDec = adjPrice.times(pricePowDec)
    let priceDec0Str = priceDec.truncate(0).toString()
    let price = BigInt.fromString(priceDec0Str)

    let dayID = timestamp / 86400
    let dayTokenComponentsID = dayID.toString().concat('_').concat(FLEX_TOKEN)
    let dayTokenComponents = new DayTokenComponent(dayTokenComponentsID)
    dayTokenComponents.date = timestamp
    dayTokenComponents.dayId = dayID
    dayTokenComponents.supply = supply.toBigDecimal()
    dayTokenComponents.token = Address.fromString(FLEX_TOKEN)
    dayTokenComponents.vaults = vaultIDs
    dayTokenComponents.totalPrice = totalPrice
    dayTokenComponents.price = price
    dayTokenComponents.name = name
    dayTokenComponents.save()
}

function handleTokenVault(
    timestamp: u32,
    targetToken: Address,
    vault: Address,
    assets: BerezkaGovernance__listTokens1ResultValue0Struct[],
    debtAdapters: Address[],
    ethAdapters: Address[],
    stakingAdapters: Address[]
): TokenVault {
    let length = assets.length;

    let components = new Array<TokenComponent>(1 + length)
    
    let ethComponent = getEthBalances(
        timestamp,
        targetToken,
        vault,
        ethAdapters
    )

    components[0] = ethComponent
    
    let notEmptyComponentCount = 0;
    for (let i = 0; i < length; i++) {
        let asset = assets[i]

        let token = asset.token
        let tokenType = asset.tokenType

        log.debug("Handling asset: {} ({})", [token.toHexString(), tokenType])

        let component = getTokenBalances(
            timestamp,
            targetToken,
            token,
            tokenType,
            vault,
            debtAdapters,
            stakingAdapters
        )

        components[1 + i] = component
        if (!component.amount.equals(BigInt.fromI32(0))) {
            notEmptyComponentCount = notEmptyComponentCount + 1    
        }
    }

    let notEmptyComponentsIDs = new Array<string>(notEmptyComponentCount)

    let totalPrice = BigInt.fromI32(0)
    for (let i = 0; i < components.length; i++) {
        if (!components[i].amount.equals(BigInt.fromI32(0))) {
            notEmptyComponentsIDs.push(components[i].id)
            totalPrice = totalPrice.plus(components[i].price)
            components[i].save()
        }
    }

    let id = timestamp.toString().concat('_').concat(targetToken.toHexString()).concat('_').concat(vault.toHexString())
    let tokenVault = new TokenVault(id)
    tokenVault.totalPrice = totalPrice
    tokenVault.vault = vault
    tokenVault.components = notEmptyComponentsIDs
    return tokenVault
}

function handleERC20Component(
    token: Address,
    amount: BigInt,
    component: TokenComponent
): void {
    log.debug('Getting component price {}', [token.toHexString()])

    log.debug('Component amount is {}', [amount.toString()])

    component.price = pricing.getTokenPrice(amount, token)
}

function handleExpandComponent(
    tokenType: string,
    token: Address,
    amount: BigInt,
    id: string,
    component: TokenComponent
): void {
    let fullBalance = registry.getFinalFullTokenBalance(tokenType, token)
    log.debug("Got final full token balance for token {} type {}", [token.toHexString(), tokenType])
    let underlying = fullBalance.underlying 
    let underlyingLength = underlying.length
    let partIDs = new Array<string>(underlyingLength)
    let totalComponmentPrice = BigInt.fromI32(0)
    for (let j = 0; j < underlyingLength; j++) {
        let part = underlying[j]
        let partAmountRato = part.amount
        let partToken      = part.metadata.token
        let partDecimals   = part.metadata.decimals
        let partName       = part.metadata.name
        log.debug('Got part component {}', [partToken.toHexString()])

        let partAmount     = (partAmountRato.times(amount)).div(BigInt.fromI32(10).pow(18))
        log.debug('Got  part token amount {}, ratio {}', [partAmount.toString(), partAmountRato.toString()])
        
        let tokenComponentPartID = id.concat('_').concat(partToken.toHexString())
        let tokenComponentPart = new TokenComponentPart(tokenComponentPartID)
        tokenComponentPart.decimals = partDecimals
        tokenComponentPart.token = partToken
        tokenComponentPart.ratio = partAmountRato
        tokenComponentPart.amount = partAmount
        tokenComponentPart.name = partName
        tokenComponentPart.price = pricing.getTokenPrice(partAmount, partToken)

        totalComponmentPrice = totalComponmentPrice.plus(tokenComponentPart.price)

        tokenComponentPart.save()
        partIDs[j] = tokenComponentPartID;
    }
    component.parts = partIDs
    component.price = totalComponmentPrice
}

function getEthBalances(
    timestamp: i32,
    token: Address,
    vault: Address,
    debtAdapters: Address[],
): TokenComponent {
    let asset = Address.fromString(ETH)
    let type = "ERC20"
    log.debug("getEthBalances asset: {} ({})", [asset.toHexString(), type.toString()])

    let componentBalance: BigInt = BigInt.fromI32(0)
    let componentDebt: BigInt = BigInt.fromI32(0)

    log.debug("getEthBalances processing vault: {}", [vault.toHexString()])
        
    let vaultTokenBalance = ethBalance.balances([vault], [Address.fromString(ZERO_ADDRESS)])[0]
    log.debug("getEthBalances got vault token balance: {}", [asset.toHexString(), vaultTokenBalance.toString()])

    componentBalance = componentBalance.plus(vaultTokenBalance)
    let ethDebt = getAdapterBalance(asset, vault, debtAdapters)
    componentDebt = componentDebt.plus(ethDebt.amount)
    
    let balance = componentBalance.minus(componentDebt)
    let id = timestamp.toString().concat('_').concat(token.toHexString()).concat('_').concat(vault.toHexString()).concat('_').concat(asset.toHexString())
    let result = new TokenComponent(id)
    result.price = BigInt.fromI32(0)
    result.parts = []
    result.debt = componentDebt
    result.deposit = componentBalance
    result.staking = BigInt.fromI32(0)
    result.debtAdapters = ethDebt.adapters
    result.stakingAdapters = []
    result.vault = vault

    handleERC20Component(
        asset,
        balance,
        result
    )

    result.token = asset
    result.tokrnStr = asset.toHexString()
    result.tokenType = type.toString()
    result.amount = balance
    result.name = "ETH"
    return result
}

function getTokenBalances(
    timestamp: i32,
    token: Address,
    asset: Address,
    type: String,
    vault: Address,
    debtAdapters: Address[],
    stakingAdapters: Address[]
): TokenComponent {
    log.debug("getTokenBalances asset: {} ({})", [asset.toHexString(), type.toString()])

    let componentBalance: BigInt = BigInt.fromI32(0)
    let componentDebt: BigInt = BigInt.fromI32(0)
    let componentStaking: BigInt = BigInt.fromI32(0)

    let assetERC20 = ERC20.bind(asset)
    log.debug("getTokenBalances processing vault: {}", [vault.toHexString()])
    
    let vaultTokenBalance = assetERC20.balanceOf(vault)
    log.debug("getTokenBalances got vault token balance: {}", [asset.toHexString(), vaultTokenBalance.toString()])

    componentBalance = componentBalance.plus(vaultTokenBalance)
    let debt = getAdapterBalance(asset, vault, debtAdapters)
    componentDebt = componentDebt.plus(debt.amount)
    let staking = getAdapterBalance(asset, vault, stakingAdapters)
    componentStaking = componentStaking.plus(staking.amount)
    
    let balance = componentBalance.minus(componentDebt).plus(componentStaking)
    let id = timestamp.toString().concat('_').concat(token.toHexString()).concat('_').concat(vault.toHexString()).concat('_').concat(asset.toHexString())
    let result = new TokenComponent(id)
    result.price = BigInt.fromI32(0)
    result.parts = []
    result.debtAdapters = debt.adapters
    result.stakingAdapters = staking.adapters

    if (!balance.equals(BigInt.fromI32(0))) {
        if (!type.includes("ERC20")) {
            handleExpandComponent(
                type.toString(),
                asset,
                balance,
                id,
                result
            )
        } else if (type.includes("ERC20")) {
            handleERC20Component(
                asset,
                balance,
                result
            )
        }
    }

    result.token = asset
    result.name = ""
    let maybeName = assetERC20.try_name()
    if (!maybeName.reverted) {
        result.name = maybeName.value
    }
    result.deposit = componentBalance
    result.debt = componentDebt
    result.staking = componentStaking
    result.tokrnStr = asset.toHexString()
    result.tokenType = type.toString()
    result.amount = balance
    result.vault = vault
    return result
}

function getAdapterBalance(
    asset: Address,
    vault: Address,
    debtAdapters: Address[]
): AdapterBalanceResult {
    log.debug("getAdapterBalance asset: {} vault {}", [asset.toHexString(), vault.toHexString()])

    let componentDebt: BigInt = BigInt.fromI32(0)
    let adapterIndexes = new Array<u32>(debtAdapters.length)
    let debtsLength = debtAdapters.length

    for (let k = 0; k < debtsLength; k++) {
        adapterIndexes[k] = 0
    }
    
    for (let k = 0; k < debtsLength; k++) {
        let debtAdapterAddress = debtAdapters[k]
        log.debug("getAdapterBalance processing debt adapter: {}", [debtAdapterAddress.toHexString()])

        let protocolAdapterContract = ProtocolAdapter.bind(debtAdapterAddress)
        let maybeAmount = protocolAdapterContract.try_getBalance(asset, vault)
        if (!maybeAmount.reverted) {
            let amount = maybeAmount.value
            log.debug("getAdapterBalance debt adapter returned amount {}", [amount.toString()])
            componentDebt = componentDebt.plus(amount)
            if (!amount.equals(BigInt.fromI32(0))) {
                adapterIndexes[k] = 1 // mark adapter as used
            }
        } else {
            log.debug("getAdapterBalance debt adapter reverted {}", [debtAdapterAddress.toHexString()])
        }
    }

    let userAdapterCount = 0
    for (let k = 0; k < debtsLength; k++) {
        if (adapterIndexes[k] === 1) {
            userAdapterCount = userAdapterCount + 1
        }
    }

    let usedAdapters = new Array<Bytes>(userAdapterCount)
    for (let k = 0; k < debtsLength; k++) {
        if (adapterIndexes[k] === 1) {
            let debtAdapterAddress = debtAdapters[k]
            usedAdapters.push(debtAdapterAddress)
        }
    }

    return new AdapterBalanceResult(componentDebt, usedAdapters)
}

class AdapterBalanceResult {
    amount: BigInt
    adapters: Bytes[]

    constructor(amount: BigInt, adapters: Bytes[]) {
        this.amount = amount
        this.adapters = adapters
    }
}

function handleDay(timestamp: i32, currentPrice: BigInt, totalSupply: BigInt, token: string, initDayId: i32): void {
    let dayID = timestamp / 86400
    if (dayID <= initDayId) {
        return
    }
    doHandleDay(timestamp, currentPrice, totalSupply, token, initDayId)
}   

function doHandleDay(timestamp: i32, currentPrice: BigInt, totalSupply: BigInt, token: string, initDayId: i32): void {
    let dayID = timestamp / 86400
    let dayStartTimestamp = dayID * 86400
    let dayDataID = token.concat("_").concat(dayID.toString())
    let dayData = DayHistoricalData.load(dayDataID)

    if (dayData == null) {
        createDayData(
            dayDataID,
            dayID, 
            dayStartTimestamp,
            token,
            currentPrice.toBigDecimal(),
            totalSupply.toBigDecimal(),
            initDayId
        )
        dayData = DayHistoricalData.load(dayDataID)!
    }

    dayData.price = dayData.price
        .plus(currentPrice.toBigDecimal())
        .div(twoBD())

    dayData.totalPrice = dayData.totalPrice
        .plus(currentPrice.toBigDecimal().times(totalSupply.toBigDecimal()))
        .div(twoBD())

    dayData.apy = dayData.apy
        .plus(computeApy(dayID, token, currentPrice.toBigDecimal(), initDayId))
        .div(twoBD())

    dayData.save()
}

function handleHour(timestamp: i32, currentPrice: BigInt, totalSupply: BigInt, token: string): void {
    let hourID = timestamp / 3600
    let hourStartTimestamp = hourID * 3600
    let hourDataID = token.concat("_").concat(hourID.toString())
    let hourData = HourHistoricalData.load(hourDataID)

    if (hourData == null) {
        createHourData(
            hourDataID,
            hourID, 
            hourStartTimestamp,
            token,
            currentPrice.toBigDecimal(),
            totalSupply.toBigDecimal()
        )
        hourData = HourHistoricalData.load(hourDataID)!
    }

    hourData.price = hourData.price
        .plus(currentPrice.toBigDecimal())
        .div(twoBD())

    hourData.totalPrice = hourData.totalPrice
        .plus(currentPrice.toBigDecimal().times(totalSupply.toBigDecimal()))
        .div(twoBD())

    hourData.save()
}

function createDayData(
        dayDataID: string,
        dayID: i32, 
        dayStartTimestamp: i32, 
        token: string, 
        price: BigDecimal, 
        supply: BigDecimal,
        initDayId: i32
): void
{
    let dayData = new DayHistoricalData(dayDataID)
    dayData.dayId = dayID
    dayData.date = dayStartTimestamp
    dayData.price = price
    dayData.token = Address.fromString(token)
    dayData.totalPrice = price.times(supply)
    dayData.supply = supply
    dayData.apy = computeApy(dayID, token, price, initDayId)
    dayData.save()
}

function createHourData(
    hourDataID: string, 
    hourID: i32, 
    hourStartTimestamp: i32, 
    token: string, 
    price: BigDecimal,
    supply: BigDecimal
): void
{
    let dayData = new HourHistoricalData(hourDataID)
    dayData.hourId = hourID
    dayData.date = hourStartTimestamp
    dayData.price = price
    dayData.token = Address.fromString(token),
    dayData.totalPrice = price.times(supply)
    dayData.supply = supply
    dayData.save()
}

function computeApy(
    currentDayID: i32, 
    token: string, 
    price: BigDecimal,
    initDayId: i32
): BigDecimal 
{
    let firstDayDataID = token.concat("_").concat(initDayId.toString())
    let firstDayData = DayHistoricalData.load(firstDayDataID)
    
    if (firstDayData != null) {
        // Formulae is: ((Pn / P0) -1 ) * 100% /Ndays*365
        //
        let p0 = firstDayData.price
        let pn = price
        let nDays = currentDayID - initDayId
        if (nDays > 0) {
            let div = pn.div(p0)
            let divMinusOne = div.minus(oneBD())
            let result = divMinusOne
                .times(bd('100'))
                .div(bd(nDays.toString()))
                .times(bd('365'))
            return result
        } else {
            return zeroBD()
        }
    } else {
        return zeroBD()
    }
}

function init(): void {
    // Init FLEX token          
    doHandleDay(1580728018, toPow(68760, 1), toPow(3126750, 18), FLEX_TOKEN, DAYID_INIT_FLEX)

    // Init EMIFLEX token
    doHandleDay(1596110400, toPow(1, 6), toPow(20000, 18), EFLX_TOKEN, DAYID_INIT_EFLX)

    // Init DYNA token
    doHandleDay(1601816804, toPow(1, 6), toPow(0, 18), DYNA_TOKEN, DAYID_INIT_DYNA)
    
    // Init BDQ token
    doHandleDay(1604923200, toPow(100111, 0), toPow(0, 18), BDQ_TOKEN, DAYID_INIT_BDQ)

    // Init skyflex token
    doHandleDay(1601813202, toPow(1, 6), toPow(0, 18), SKYFLEX_TOKEN, DAYID_INIT_SKYFLEX)
}

export function toPow(value: i32, pow: u8): BigInt {
    return BigInt.fromI32(value).times(BigInt.fromI32(10).pow(pow))
}

export function zeroBD(): BigDecimal {
    return BigDecimal.fromString('0')
}

export function twoBD(): BigDecimal {
    return BigDecimal.fromString('2')
}

export function oneBD(): BigDecimal {
    return BigDecimal.fromString('1')
}

export function bd(amount: string): BigDecimal {
    return BigDecimal.fromString(amount)
}

function strlen(arr: Array<Address>): string {
    let len = arr.length
    return len.toString()
}