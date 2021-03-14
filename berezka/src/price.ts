import { BigDecimal, Address, ethereum, BigInt } from "@graphprotocol/graph-ts"
import { BerezkaPriceTracker } from "../generated/Contract/BerezkaPriceTracker"
import { ERC20 } from "../generated/Contract/ERC20"
import { DayHistoricalData, HourHistoricalData } from "../generated/schema"

const PRICE_API_ROOT = "0x2184FaE5a2e3355DF155AD3cDb2089F9f6e0868B"

const FLEX_TOKEN     = "0x0D7DeA5922535087078dd3D7c554EA9f2655d4cB"
const EFLX_TOKEN     = "0xD68E7b64888F095Ee15f18347ccA7e453E0DBe17"
const BDQ_TOKEN      = "0xf6ce9BFA82D1088d3257a76ec2e0ce1C8060BF8c"
const DYNA_TOKEN     = "0xdc76450fd7e6352733fe8550efabff750b2de0e3"
const SKYFLEX_TOKEN  = "0x26677EB24FD007Ad279FC55f367De31482E1bF54"

const INIT_BLOCK_NUMBER = 11179182

// For APY computations use different 

const DAYID_INIT_FLEX    = 18295
const DAYID_INIT_EFLX    = 18473
const DAYID_INIT_BDQ     = 18573
const DAYID_INIT_DYNA    = 18539
const DAYID_INIT_SKYFLEX = 18524

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
    if (blockNumber % 50 != 0) {
        return;
    }

    let timestamp = block.timestamp.toI32()
    
    let priceTracker = BerezkaPriceTracker.bind(Address.fromString(PRICE_API_ROOT))

    let flexToken    = ERC20.bind(Address.fromString(FLEX_TOKEN))
    let eflxToken    = ERC20.bind(Address.fromString(EFLX_TOKEN))
    let bdqToken     = ERC20.bind(Address.fromString(BDQ_TOKEN))
    let dynaToken    = ERC20.bind(Address.fromString(DYNA_TOKEN))
    let skyflexToken = ERC20.bind(Address.fromString(SKYFLEX_TOKEN))

    let flexPrice    = priceTracker.try_getPrice(Address.fromString(FLEX_TOKEN))
    let eflxPrice    = priceTracker.try_getPrice(Address.fromString(EFLX_TOKEN))
    let bdqPrice     = priceTracker.try_getPrice(Address.fromString(BDQ_TOKEN))
    let dynaPrice    = priceTracker.try_getPrice(Address.fromString(DYNA_TOKEN))
    //let skyflexPrice = priceTracker.try_getPrice(Address.fromString(SKYFLEX_TOKEN))

    let flexSupply    = flexToken.totalSupply()
    let eflxSupply    = eflxToken.totalSupply()
    let bdqSupply     = bdqToken.totalSupply()
    let dynaSupply    = dynaToken.totalSupply()
    let skyflexSupply = skyflexToken.totalSupply()

    if (!flexPrice.reverted) {
        handleDay(timestamp, flexPrice.value, flexSupply, FLEX_TOKEN, DAYID_INIT_FLEX)
    }
    if (!eflxPrice.reverted) {
        handleDay(timestamp, eflxPrice.value, eflxSupply, EFLX_TOKEN, DAYID_INIT_EFLX)
    }
    if (!bdqPrice.reverted) {
        handleDay(timestamp, bdqPrice.value , bdqSupply , BDQ_TOKEN , DAYID_INIT_BDQ)
    }
    if (!dynaPrice.reverted) {
        handleDay(timestamp, dynaPrice.value, dynaSupply, DYNA_TOKEN, DAYID_INIT_DYNA)
    }
    // handleDay(timestamp, skyflexPrice, skyflexSupply, SKYFLEX_TOKEN, DAYID_INIT_SKYFLEX)

    if (!flexPrice.reverted) {
        handleHour(timestamp, flexPrice.value, flexSupply, FLEX_TOKEN)
    }
    if (!eflxPrice.reverted) {
        handleHour(timestamp, eflxPrice.value, eflxSupply, EFLX_TOKEN)
    }
    if (!bdqPrice.reverted) {
        handleHour(timestamp, bdqPrice.value, bdqSupply , BDQ_TOKEN)
    }
    if (!dynaPrice.reverted) {
        handleHour(timestamp, dynaPrice.value, dynaSupply, DYNA_TOKEN)
    }
    // handleHour(timestamp, skyflexPrice, skyflexSupply, SKYFLEX_TOKEN)
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