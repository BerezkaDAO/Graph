const fetch = require("node-fetch")
const data = require("./data")
const rs = data.rs

const ignored = [
  "0x0715e918179351852bc43ffddf33c3a0d2354fa8",
  "0x0d7dea5922535087078dd3d7c554ea9f2655d4cb",
  "0x21a6ead8a66fb18d7948424eef67d05d9548c198",
  "0x73f71d6765822bdd6b9dd5915ea667c58b4fd4c9",
  "0x77c6e4a580c0dce4e5c7a17d0bc077188a83a059",
  "0x79e2fa1928edfd7f002a2927d054d2b02b8ead24",
  "0x983dea4db4b2b773190566ccae4c58f417583ea6",
  "0xa9517b2e61a57350d6555665292dbc632c76adfe",
  "0xb07de4b2989e180f8907b8c7e617637c26ce2776",
  "0x619beb58998ed2278e08620f97007e1116d5d25b"
]

const run = async() => {
  const vaults = rs.data.dayTokenComponents[0].vaults
  for (vault of vaults) {
    const address = vault.vault
    const vaultTokenInfo = await fetch(`https://api.ethplorer.io/getAddressInfo/${address}?apiKey=freekey`).then(rs => rs.json())
    const foundComponents = vault.components.map(c => c.token.toLowerCase())
    const actualComponents = vaultTokenInfo.tokens.map(t => t.tokenInfo.address.toLowerCase())
    const missingComponents = []
    for (actualComponent of actualComponents) {
      if (!foundComponents.includes(actualComponent) && !ignored.includes(actualComponent)) {
        missingComponents.push(actualComponent)
      }
    }
    console.log(JSON.stringify({
      "vault": address,
      "missing": missingComponents
    }, null, 2))
  }
}

run()