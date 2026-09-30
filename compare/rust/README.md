# Tennex in Rust (partial port)

Parts of Tennex rewritten in Rust with the [Bevy](https://bevyengine.org) game engine, built from the same spec as the JavaScript version (`../../docs/SPEC.md`). It exists to compare the two languages on identical requirements; it is not a playable port.

| File | Spec | Compare with |
|---|---|---|
| `src/router.rs` | R4 who a message is for | `src/brain/router.js` |
| `src/reply.rs` | R5 SAY/SCREEN reply parser | `src/brain/parser.js` |
| `src/game.rs` | R1 walking, R2 push-to-talk, R6 scene, R9 status (Bevy systems) | `src/main.js`, `src/world/*.js` |

```bash
cargo test                    # 11 tests: the same cases as the JavaScript tests
cargo check --features bevy   # type-checks the Bevy code (first run downloads Bevy, a few minutes)
```

Uses Rust 1.95 (pinned in `rust-toolchain.toml`) and Bevy 0.19.
