const fetch = require("node-fetch")
const data = require("./data")
const rs = data.rs

const fmtn = (num, decs = 0) => {
  return `$${Math.round(num/10**6, decs).toLocaleString()}`
}
const run = async() => {
  const vaults = rs.data.dayTokenComponents[0].vaults
  for (vault of vaults) {
    const address = vault.vault
    console.log(`${address} ${fmtn(vault.totalPrice)}`)
    console.log(`================`)

    for (c of vault.components) {
      console.log(`${c.name} - ${c.token} - ${fmtn(c.price)}`)
    }
    
  }
}

run()