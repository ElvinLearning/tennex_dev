//! Bevy (a Rust game engine) versions of a few Tennex systems.
//! Compare with src/main.js and src/world/*.js, which implement the same spec with three.js.

use bevy::prelude::*;

use crate::router::{AgentId, Route, route};

pub struct TennexPlugin;

impl Plugin for TennexPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<Microphone>()
            .insert_resource(Colliders(vec![Box2 { min: Vec2::new(-1.0, -9.7), max: Vec2::new(1.0, -8.7) }]))
            .add_message::<Prompt>()
            .add_systems(Startup, spawn_desk)
            .add_systems(Update, (walk, push_to_talk, report_status_changes));
    }
}

// ---------------------------------------------------------------- data (components)
// JS: an agent is one big object with everything on it (class AgentActor).
// Bevy: an agent is just an id; small pieces of data ("components") are attached to it.

#[derive(Component)]
pub struct Agent(pub AgentId);

#[derive(Component)]
pub struct Player;

/// R9 AC3. JS stores a string such as 'thinking'; a typo there is a silent bug.
#[derive(Component, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Autopilot,
    Listening,
    Thinking,
    Shipping,
    Talking,
    OnBreak,
    Crashed,
}

#[derive(Resource)]
pub struct Focused(pub AgentId);

// ---------------------------------------------------------------- R6: build the scene
// JS:   const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.85), material);
//       m.position.set(0, 0.75, -9.2); scene.add(m);
fn spawn_desk(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>, mut materials: ResMut<Assets<StandardMaterial>>) {
    commands.spawn((
        Mesh3d(meshes.add(Cuboid::new(1.9, 0.05, 0.85))),
        MeshMaterial3d(materials.add(Color::srgb(0.84, 0.83, 0.81))),
        Transform::from_xyz(0.0, 0.75, -9.2),
    ));
    commands.spawn((Agent(AgentId::Tenx), Status::Autopilot, Transform::from_xyz(0.0, 0.0, -8.4)));
    commands.spawn((Player, Transform::from_xyz(0.0, 1.65, 0.0)));
}

// ---------------------------------------------------------------- R1: walk + collide
const PLAYER_R: f32 = 0.3;

#[derive(Clone, Copy)]
pub struct Box2 {
    pub min: Vec2,
    pub max: Vec2,
}

#[derive(Resource)]
pub struct Colliders(pub Vec<Box2>);

// JS reads a global `keys` Set filled in by event listeners.
// Bevy passes in exactly what the function asks for, by type, every frame.
fn walk(keys: Res<ButtonInput<KeyCode>>, time: Res<Time>, walls: Res<Colliders>, mut player: Query<&mut Transform, With<Player>>) {
    let Ok(mut t) = player.single_mut() else { return };
    let speed = if keys.pressed(KeyCode::ShiftLeft) { 7.0 } else { 3.6 }; // R1 AC1
    let (fwd, right) = (t.forward().with_y(0.0), t.right().with_y(0.0));
    let mut dir = Vec3::ZERO;
    if keys.pressed(KeyCode::KeyW) { dir += fwd; }
    if keys.pressed(KeyCode::KeyS) { dir -= fwd; }
    if keys.pressed(KeyCode::KeyD) { dir += right; }
    if keys.pressed(KeyCode::KeyA) { dir -= right; }
    t.translation += dir.normalize_or_zero() * speed * time.delta_secs();
    for b in &walls.0 {
        push_out(&mut t.translation, *b); // R1 AC2
    }
}

/// Same math as collide() in main.js: move the player's circle out of the box.
fn push_out(p: &mut Vec3, b: Box2) {
    let nearest = Vec2::new(p.x, p.z).clamp(b.min, b.max);
    let away = Vec2::new(p.x, p.z) - nearest;
    if away.length_squared() < PLAYER_R * PLAYER_R && away.length_squared() > 1e-8 {
        let fixed = nearest + away.normalize() * PLAYER_R;
        (p.x, p.z) = (fixed.x, fixed.y);
    }
}

// ---------------------------------------------------------------- R2: push-to-talk
#[derive(Resource, Default)]
pub struct Microphone {
    listening: bool,
    heard: String, // filled by a speech-to-text library; browsers have one built in, native apps don't
}

#[derive(Message)]
pub struct Prompt {
    pub to: AgentId,
    pub text: String,
}

// JS: addEventListener('keydown', ...) calls us when V goes down.
// Bevy: this runs every frame and asks "did V go down this frame?"
fn push_to_talk(keys: Res<ButtonInput<KeyCode>>, mut mic: ResMut<Microphone>, focused: Option<Res<Focused>>, mut prompts: MessageWriter<Prompt>) {
    if keys.just_pressed(KeyCode::KeyV) {
        mic.listening = true; // R2 AC1
        mic.heard.clear();
    }
    if keys.just_released(KeyCode::KeyV) && mic.listening {
        mic.listening = false;
        let heard = std::mem::take(&mut mic.heard);
        // The compiler refuses to build this until all three cases are handled.
        match route(&heard, focused.map(|f| f.0)) {
            Route::One(to, text) => {
                prompts.write(Prompt { to, text: text.to_string() });
            }
            Route::Everyone(text) => {
                for to in AgentId::ALL {
                    prompts.write(Prompt { to, text: text.to_string() });
                }
            }
            Route::Nobody => warn!("Nobody heard {heard:?}"), // R4 AC3
        }
    }
}

// ---------------------------------------------------------------- R9: status changes
// JS: setStatus() checks `if (this.status === key) return` by hand before redrawing the tag.
// Bevy: `Changed<Status>` asks the engine for only the agents whose status changed this frame.
fn report_status_changes(agents: Query<(&Agent, &Status), Changed<Status>>) {
    for (agent, status) in &agents {
        info!("{:?} is now {:?}", agent.0, status);
    }
}
