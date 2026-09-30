//! Spec R4 — decide who a message is for. Same rules as src/brain/router.js.

/// In JavaScript an agent is the string "tenx"; a typo like "tenz" is only caught at runtime.
/// Here it is a closed set: the compiler rejects any agent that doesn't exist.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentId {
    Tenx,
    Assert,
    Vector,
    Deploy,
    Critic,
}

impl AgentId {
    pub const ALL: [AgentId; 5] = [Self::Tenx, Self::Assert, Self::Vector, Self::Deploy, Self::Critic];

    fn aliases(self) -> &'static [&'static str] {
        match self {
            Self::Tenx => &["tenx", "10x", "ten x"], // R4 AC2: speech-recognition spellings
            Self::Assert => &["assert"],
            Self::Vector => &["vector", "victor"],
            Self::Deploy => &["deploy"],
            Self::Critic => &["critic", "critique"],
        }
    }

    /// R4 AC1: names that are also verbs need a cue (@, a greeting, or punctuation).
    fn is_verb(self) -> bool {
        matches!(self, Self::Deploy | Self::Assert)
    }
}

/// Where a message goes. JavaScript returns `{ targets: [], text }` and every caller
/// has to remember that an empty array means "nobody". Here "nobody" is its own case,
/// and `match` will not compile until every caller handles it (R4 AC3).
#[derive(Debug, PartialEq)]
pub enum Route<'a> {
    Everyone(&'a str),
    One(AgentId, &'a str),
    Nobody,
}

pub fn route(text: &str, focused: Option<AgentId>) -> Route<'_> {
    let text = text.trim();
    let (body, greeted) = strip_greeting(text);

    if let Some(rest) = strip_name(body, "team", false) {
        return Route::Everyone(rest);
    }
    for id in AgentId::ALL {
        for alias in id.aliases() {
            if let Some(rest) = strip_name(body, alias, id.is_verb() && !greeted) {
                return Route::One(id, rest);
            }
        }
    }
    if let Some(id) = single_mention(text) {
        return Route::One(id, text);
    }
    match focused {
        Some(id) => Route::One(id, text),
        None => Route::Nobody,
    }
}

fn strip_greeting(text: &str) -> (&str, bool) {
    for g in ["hey ", "hi ", "yo ", "ok ", "okay ", "hello "] {
        if starts_with_ci(text, g) {
            return (text[g.len()..].trim_start_matches([' ', ',']), true);
        }
    }
    (text, text.starts_with('@'))
}

/// "Critic, review this" -> Some("review this"). Borrowed slices, no copying.
fn strip_name<'a>(body: &'a str, name: &str, strict: bool) -> Option<&'a str> {
    let (after, mentioned) = match body.strip_prefix('@') {
        Some(rest) if starts_with_ci(rest, name) => (&rest[name.len()..], true),
        _ if starts_with_ci(body, name) => (&body[name.len()..], false),
        _ => return None,
    };
    let next = after.chars().next();
    if next.is_some_and(|c| c.is_alphanumeric() || c == '-') {
        return None; // "vectorize" is not "vector"
    }
    if strict && !mentioned && !next.is_some_and(|c| ",:!-".contains(c)) {
        return None; // "deploy it" stays with whoever you're facing
    }
    let rest = after.trim_start_matches([' ', ',', ':', '.', '!', '-']);
    (!rest.is_empty()).then_some(rest)
}

fn single_mention(text: &str) -> Option<AgentId> {
    let mut found = AgentId::ALL.into_iter().filter(|id| {
        text.split_whitespace().any(|w| {
            w.strip_prefix('@').is_some_and(|w| {
                let w = w.trim_end_matches(|c: char| !c.is_alphanumeric());
                id.aliases()[0].eq_ignore_ascii_case(w)
            })
        })
    });
    match (found.next(), found.next()) {
        (Some(id), None) => Some(id),
        _ => None,
    }
}

fn starts_with_ci(s: &str, prefix: &str) -> bool {
    s.get(..prefix.len()).is_some_and(|p| p.eq_ignore_ascii_case(prefix))
}

#[cfg(test)]
mod tests {
    use super::{AgentId::*, Route::*, *};

    // The same cases as tests/router.test.js, so both languages meet the same spec.
    #[test]
    fn defaults_to_the_focused_agent() {
        assert_eq!(route("build a todo app", Some(Tenx)), One(Tenx, "build a todo app"));
        assert_eq!(route("build a todo app", None), Nobody);
    }

    #[test]
    fn routes_by_name_with_comma_at_or_greeting() {
        assert_eq!(route("Critic, review this", Some(Tenx)), One(Critic, "review this"));
        assert_eq!(route("@deploy ship it", None), One(Deploy, "ship it"));
        assert_eq!(route("hey vector what next", None), One(Vector, "what next"));
    }

    #[test]
    fn understands_speech_spellings_of_tenx() {
        assert_eq!(route("hey 10x build a CLI", None), One(Tenx, "build a CLI"));
        assert_eq!(route("ten x make it faster", None), One(Tenx, "make it faster"));
    }

    #[test]
    fn verb_names_need_a_cue() {
        assert_eq!(route("deploy it to staging", Some(Tenx)), One(Tenx, "deploy it to staging"));
        assert_eq!(route("assert that x is 1", Some(Critic)), One(Critic, "assert that x is 1"));
        assert_eq!(route("hey deploy roll back", Some(Tenx)), One(Deploy, "roll back"));
    }

    #[test]
    fn broadcasts_to_the_team() {
        assert_eq!(route("Team, what should we ship today?", None), Everyone("what should we ship today?"));
    }

    #[test]
    fn single_mention_anywhere() {
        assert_eq!(route("can you @critic look at this", Some(Tenx)), One(Critic, "can you @critic look at this"));
    }

    #[test]
    fn does_not_match_inside_words() {
        assert_eq!(route("vectorize this loop", Some(Tenx)), One(Tenx, "vectorize this loop"));
    }
}
