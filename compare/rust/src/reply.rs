//! Spec R5 — one streamed reply drives both voice (SAY) and monitor (SCREEN).
//! Same behaviour as src/brain/parser.js, written as an explicit state machine.

const SAY: &str = "SAY:";
const SCREEN: &str = "SCREEN:";

/// JavaScript tracks this with a boolean (`this.inScreen`) plus a loose `skipLead` flag.
/// Rust makes each state a variant, and the data a state needs lives inside it.
#[derive(Debug, Clone, Copy, PartialEq)]
enum State {
    Say { sent: usize },
    Screen { skip_newline: bool },
}

/// What the parser hands back. The JS version calls two callbacks instead.
#[derive(Debug, PartialEq)]
pub enum Delta {
    Say(String),
    Screen(String),
}

pub struct ReplyParser {
    raw: String,
    state: State,
}

impl Default for ReplyParser {
    fn default() -> Self {
        Self { raw: String::new(), state: State::Say { sent: 0 } }
    }
}

impl ReplyParser {
    pub fn push(&mut self, chunk: &str) -> Vec<Delta> {
        let mut out = Vec::new();
        let start = self.raw.len();
        self.raw.push_str(chunk);

        match self.state {
            State::Screen { skip_newline } => self.emit_screen(start, skip_newline, &mut out),
            State::Say { sent } => match find_screen_marker(&self.raw) {
                Some((before_end, after)) => {
                    self.emit_say(sent, before_end, &mut out);
                    self.state = State::Screen { skip_newline: true };
                    self.emit_screen(after, true, &mut out);
                }
                None => {
                    // AC3: hold back a tail that could still become "SCREEN:" (e.g. "\nSCR").
                    let safe = self.raw.len() - partial_marker_len(&self.raw);
                    self.emit_say(sent, safe, &mut out);
                }
            },
        }
        out
    }

    pub fn end(&mut self) -> Vec<Delta> {
        let mut out = Vec::new();
        if let State::Say { sent } = self.state {
            self.emit_say(sent, self.raw.len(), &mut out); // AC4: no SCREEN → speech only
        }
        out
    }

    fn emit_say(&mut self, sent: usize, end: usize, out: &mut Vec<Delta>) {
        let text = &self.raw[..end];
        let body_start = text.len() - text.trim_start().len();
        let body = &text[body_start..];
        // Don't speak "SAY:" itself, or a half-arrived "SA".
        let skip = match body.strip_prefix(SAY) {
            Some(rest) => end - rest.trim_start().len(),
            None if SAY.starts_with(body) => return,
            None => body_start,
        };
        let from = sent.max(skip);
        if end > from {
            out.push(Delta::Say(self.raw[from..end].to_string()));
            self.state = State::Say { sent: end };
        }
    }

    fn emit_screen(&mut self, from: usize, skip_newline: bool, out: &mut Vec<Delta>) {
        let mut text = &self.raw[from..];
        if skip_newline {
            let trimmed = text.trim_start_matches([' ', '\t']);
            if trimmed.is_empty() {
                return; // still waiting to see whether a newline follows "SCREEN:"
            }
            text = trimmed.strip_prefix('\n').unwrap_or(trimmed);
            self.state = State::Screen { skip_newline: false };
        }
        if !text.is_empty() {
            out.push(Delta::Screen(text.to_string()));
        }
    }
}

/// "SCREEN:" only counts at the start of a line. Returns (end of the SAY part, start of the SCREEN part).
fn find_screen_marker(raw: &str) -> Option<(usize, usize)> {
    let mut line_start = 0;
    for line in raw.split_inclusive('\n') {
        let indent = line.len() - line.trim_start_matches([' ', '\t']).len();
        if line[indent..].starts_with(SCREEN) {
            return Some((line_start, line_start + indent + SCREEN.len()));
        }
        line_start += line.len();
    }
    None
}

/// Length of the tail that might be the start of "\nSCREEN:" still arriving.
fn partial_marker_len(raw: &str) -> usize {
    let last_line = raw.rsplit('\n').next().unwrap_or("");
    let trimmed = last_line.trim_start_matches([' ', '\t']);
    if !trimmed.is_empty() && SCREEN.starts_with(trimmed) {
        // hold back the newline too, so speech never ends on a dangling line break
        last_line.len() + usize::from(raw.len() > last_line.len())
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(chunks: &[&str]) -> (String, String) {
        let mut p = ReplyParser::default();
        let (mut say, mut screen) = (String::new(), String::new());
        let deltas = chunks.iter().flat_map(|c| p.push(c)).collect::<Vec<_>>();
        for d in deltas.into_iter().chain(p.end()) {
            match d {
                Delta::Say(s) => say += &s,
                Delta::Screen(s) => screen += &s,
            }
        }
        (say.trim().to_string(), screen.trim_end().to_string())
    }

    const REPLY: &str = "SAY: Shipping it now. Tests are green!\nSCREEN:\nconst x = 1;\n+ added line\n";

    // Same test as tests/parser.test.js: split the reply at every chunk size 1-12.
    #[test]
    fn same_result_for_every_chunking() {
        for size in 1..=12 {
            let chunks: Vec<&str> = REPLY.as_bytes().chunks(size).map(|b| std::str::from_utf8(b).unwrap()).collect();
            let (say, screen) = run(&chunks);
            assert_eq!(say, "Shipping it now. Tests are green!", "chunk size {size}");
            assert_eq!(screen, "const x = 1;\n+ added line", "chunk size {size}");
        }
    }

    #[test]
    fn never_leaks_a_partial_marker() {
        let mut p = ReplyParser::default();
        let first = p.push("SAY: Hi.\nSCR");
        assert_eq!(first, vec![Delta::Say("Hi.".into())]);
        assert_eq!(run(&["SAY: Hi.\nSCR", "EEN:\ncode"]), ("Hi.".into(), "code".into()));
    }

    #[test]
    fn no_screen_section_is_speech_only() {
        assert_eq!(run(&["SAY: Just chatting. ", "Nothing to show."]), ("Just chatting. Nothing to show.".into(), String::new()));
    }

    #[test]
    fn screen_marker_must_start_a_line() {
        assert_eq!(run(&["SAY: my SCREEN: is huge.\nSCREEN:\nok"]), ("my SCREEN: is huge.".into(), "ok".into()));
    }
}
