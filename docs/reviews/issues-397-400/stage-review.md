# Live stage review

The retained images exercise the real story renderer, height table, backdrop
loading and phone layout. A temporary copy of `e2e/cast-shot.spec.ts` applies a
scene-to-art/cast map to client-fetched Gemfall review fixtures and opens the TV
in the host's authenticated browser context. It does not alter authored narration
or claim to be a Riftlight playthrough. The temporary spec is removed.

The 15-setup run produced all 45 TV, watcher-phone and host-phone PNGs, then timed
out at five minutes while closing contexts/traces (including a truncated trace
error). That is a capture-tool limitation, not a clean test pass. After review,
the crow flock's total pose height changed from 45 to 80 cm so its front-row birds
read at about 48 cm each. A focused Bellow/herder/crow retry **passed in 1.5 minutes**.
The retained images for those three setups are the successful retry's current
captures. The earlier first-batch two-scene run also passed.

[Capture map and fixture context](stage-captures.json).

| Figure | TV before | TV after | Phone before | Phone after |
| --- | --- | --- | --- | --- |
| Master Dunnick | [Before](https://assets.kd.readysetcloud.io/sha256/5c/5cd3dfca60d762991964e4afb8625ec143a30ba10f01eed7e31e8f0f90b485f6.webp) | [After](https://assets.kd.readysetcloud.io/sha256/f0/f0ce5b781db5089f2eab2bd2a58e1ef86a5e54eab2a62f46ada0bf3d39a63a57.webp) | [Before](https://assets.kd.readysetcloud.io/sha256/a9/a96e9865df4a78757fdd3d8fef28336ee146c19b0a95fc1b924bcc552cdb3dc6.webp) | [After](https://assets.kd.readysetcloud.io/sha256/ec/ec8e3d0f2d293b1538bd7dacdff368fc5822d072be3094cb09613fd43d1f4132.webp) |
| Professor Nettle | [Before](https://assets.kd.readysetcloud.io/sha256/09/09c75448618c7dde85675fae45bbab084c1ab2ca0fcc6308858776dd8bd643cf.webp) | [After](https://assets.kd.readysetcloud.io/sha256/ac/ac67d5ece8ac7678ebb96d6d63732b2ff18693db05ebe9bc93ba795c37bfc86e.webp) | [Before](https://assets.kd.readysetcloud.io/sha256/fe/fee8a0c8ba9f9a5a9160b9fb7294c2f8ea521e4ad584e8c3438abd1a19a82f1b.webp) | [After](https://assets.kd.readysetcloud.io/sha256/c0/c0cc941d17fe33e616403321283325158141c185a807f45e54ae53b52e301cec.webp) |
| Aunt Bellow | [Before](https://assets.kd.readysetcloud.io/sha256/a1/a1ec99f890b14e0fe5560bdae016e76414f07633e60bbcb0ddd82a29db324af2.webp) | [After](https://assets.kd.readysetcloud.io/sha256/70/703de58de8481c95f91eec26bf5edea690cfc541b9a68f574779a62492420954.webp) | [Before](https://assets.kd.readysetcloud.io/sha256/42/426400db504acd54db3a919ef85d34b578164822daa404d083eb287755ec4906.webp) | [After](https://assets.kd.readysetcloud.io/sha256/17/17f3689ff6e30cd07ec1200a5c7fa14c9aadffed98ca90317db8083904fe2271.webp) |
| Yeti herder | [Before](https://assets.kd.readysetcloud.io/sha256/b0/b0f302453a9ff2633e430af09832e9f2aa496f204efbd9e361af1c2c9ace92f7.webp) | [After](https://assets.kd.readysetcloud.io/sha256/cc/cc9cb4da7a1a914f036234d37994e44e2adef7c2fdcd5e136a55295274621381.webp) | [Before](https://assets.kd.readysetcloud.io/sha256/6f/6f9c3c3d795130c1a10ef0d8dbc283bf20bc6194140aa950d3cb9756d7411723.webp) | [After](https://assets.kd.readysetcloud.io/sha256/78/780ebdc6f654a0fa09b79f0d418f4c73774e55182e130be63e4c7aa0e8417b78.webp) |
| The crows | — | [After](https://assets.kd.readysetcloud.io/sha256/d4/d4ec12dac781c99864c9f71b7f33231f13480238b4a4cca239a282026e378d45.webp) | — | [After](https://assets.kd.readysetcloud.io/sha256/8c/8c6b80d84e6c4a90faefd0d3eff1f9503c74eca34259e1c7ab50fac0b557fd9a.webp) |

| Backdrop | TV | Phone |
| --- | --- | --- |
| Wrong Valley | [View](https://assets.kd.readysetcloud.io/sha256/5d/5d872b9bf0003ca5d4569c7323ba652c8e632d49237c1aa53af6521d148a8455.webp) | [View](https://assets.kd.readysetcloud.io/sha256/83/83ee8c599e3066bbce2b72c5dd52d2b46a7ef6cdf56b03290baa72b4e893c4bc.webp) |
| Convergence Ledge | [View](https://assets.kd.readysetcloud.io/sha256/71/71ca045610ac3664e79ae7a4482bbe6b2f48e785aad26ef0ce30a758d6e3d2ea.webp) | [View](https://assets.kd.readysetcloud.io/sha256/f3/f3c30de480efc5cc81adf9ecbe79ee95508211467bd4817172f1ac7012a2704d.webp) |
| Wyrm Nest | [View](https://assets.kd.readysetcloud.io/sha256/92/92d2a7aea95eb99d996e5f60dc5c297e5a36668cbe0e1fec9a16d5108baa1230.webp) | [View](https://assets.kd.readysetcloud.io/sha256/68/68998173fbbfe4b58492352adf0187127c1cd7e790e245527f3dd416f7355a1f.webp) |
| Bone Yard Ruins | [View](https://assets.kd.readysetcloud.io/sha256/26/263fab0a2d7838916a66beb01d4f95c4b9ab442105a0f2acab955776d1ea344e.webp) | [View](https://assets.kd.readysetcloud.io/sha256/69/6991673b83626c320bcc8682d77c16c6b402acf25ddb24081c4e4c51c8398764.webp) |
| Singing Hall Camp | [View](https://assets.kd.readysetcloud.io/sha256/52/52629ce44b5da65603116ad5655e8cd4816e9ba38f1d40223ae103fad43c0e08.webp) | [View](https://assets.kd.readysetcloud.io/sha256/84/84ddb2a9023442da3f666cf27949280851ba7bc390b39432f58a813b6c40a437.webp) |
| Island Due Back | [View](https://assets.kd.readysetcloud.io/sha256/6b/6b728d674688fd08a53d2d8b71f1fbf94fb0bf077e449330a254ddcbcdc88241.webp) | [View](https://assets.kd.readysetcloud.io/sha256/0d/0d37810cbe63d44ffac881472a5f54b09c26664fe8ba5eb6d53090eab6c8ec30.webp) |

Dojo, Academy, Conservatory, Singing Hall and Rookery are visible behind their
corresponding teachers above. Captain Thimble's stage review is retained in the
[first-batch record](README.md). All 21 cutouts are also reviewed at a 120 px
visible height on [light](https://assets.kd.readysetcloud.io/sha256/34/34132e12623dbbe46dbcd1c076becfd2d479d310f45e6c24c7b5f26f786717dc.webp) and [dark](https://assets.kd.readysetcloud.io/sha256/c2/c285d7c9be93ce9320867e004b0beb5986146177f10362229eee0d14df99c9c1.webp).
The 15 hero variants have static review and renderer lookup tests; these captures
do not claim to show a live Sworn/Radiant party.
