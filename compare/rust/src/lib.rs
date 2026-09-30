//! Tennex, partly rewritten in Rust to compare languages against the same spec (docs/SPEC.md).
//! `cargo test` runs the plain-Rust modules; `cargo check --features bevy` checks the engine code.

pub mod reply;
pub mod router;

#[cfg(feature = "bevy")]
pub mod game;
