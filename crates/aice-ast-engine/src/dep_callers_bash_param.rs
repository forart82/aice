#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ParamHdr {
    Init,
    Prefix(bool),
    Special,
    Digits,
    Name,
    PrefixSpecial(bool),
    PrefixDigits(bool),
    PrefixName(bool),
    Bracket(usize, bool, bool),
    PrefixBracket,
    AfterBracket,
    Op,
    Invalid,
}

fn is_op_ch(c: char) -> bool {
    matches!(c, ':' | '-' | '=' | '+' | '?' | '#' | '%' | '/' | '^' | ',')
}

impl ParamHdr {
    pub(crate) fn step_char(&mut self, ch: char) {
        *self = match *self {
            Self::Op => Self::Op,
            Self::Bracket(d, nw, hp) => match ch {
                ']' if d == 0 => {
                    if !nw { Self::Invalid } else if hp { Self::PrefixBracket } else { Self::AfterBracket }
                }
                ']' => Self::Bracket(d - 1, true, hp),
                '[' => Self::Bracket(d + 1, true, hp),
                c if !c.is_ascii_whitespace() => Self::Bracket(d, true, hp),
                _ => Self::Bracket(d, nw, hp),
            },
            Self::Init => match ch {
                '#' | '!' => Self::Prefix(ch == '#'),
                '?' | '$' | '-' | '*' | '@' => Self::Special,
                c if c.is_ascii_digit() => Self::Digits,
                c if c.is_ascii_alphabetic() || c == '_' => Self::Name,
                _ => Self::Invalid,
            },
            Self::Prefix(is_hash) => match ch {
                c if c.is_ascii_digit() => Self::PrefixDigits(is_hash),
                c if c.is_ascii_alphabetic() || c == '_' => Self::PrefixName(is_hash),
                '#' if is_hash => Self::Op,
                '?' | '-' | '#' => Self::PrefixSpecial(true),
                '*' | '@' => Self::PrefixSpecial(!is_hash),
                '!' | '$' => if is_hash { Self::PrefixSpecial(false) } else { Self::Invalid },
                c if is_op_ch(c) => Self::Op,
                _ => Self::Invalid,
            },
            Self::PrefixSpecial(allow_op) => {
                if allow_op && (is_op_ch(ch) || ch == '@') { Self::Op } else { Self::Invalid }
            }
            Self::PrefixDigits(is_hash) => {
                if ch.is_ascii_digit() { Self::PrefixDigits(is_hash) }
                else if !is_hash && (is_op_ch(ch) || ch == '@') { Self::Op }
                else { Self::Invalid }
            }
            Self::PrefixName(is_hash) => match ch {
                c if c.is_ascii_alphanumeric() || c == '_' => Self::PrefixName(is_hash),
                '[' => Self::Bracket(0, false, is_hash),
                '*' | '@' if !is_hash => Self::Op,
                c if !is_hash && is_op_ch(c) => Self::Op,
                _ => Self::Invalid,
            },
            Self::Digits => {
                if ch.is_ascii_digit() { Self::Digits }
                else if is_op_ch(ch) || ch == '@' { Self::Op }
                else { Self::Invalid }
            }
            Self::Special | Self::AfterBracket => {
                if is_op_ch(ch) || ch == '@' { Self::Op } else { Self::Invalid }
            }
            Self::Name => match ch {
                c if c.is_ascii_alphanumeric() || c == '_' => Self::Name,
                '[' => Self::Bracket(0, false, false),
                c if is_op_ch(ch) || c == '@' => Self::Op,
                _ => Self::Invalid,
            },
            Self::PrefixBracket | Self::Invalid => Self::Invalid,
        };
    }

    pub(crate) fn on_backslash(&mut self) {
        *self = match *self {
            Self::Op => Self::Op,
            Self::Bracket(d, _, hp) => Self::Bracket(d, true, hp),
            _ => Self::Invalid,
        };
    }

    pub(crate) fn on_quote_or_dollar_open(&mut self) {
        *self = match *self {
            Self::Op => Self::Op,
            Self::Bracket(d, _, hp) => Self::Bracket(d, true, hp),
            _ => Self::Invalid,
        };
    }

    pub(crate) fn is_valid_end(self) -> bool {
        matches!(
            self,
            Self::Prefix(_)
                | Self::Special
                | Self::Digits
                | Self::Name
                | Self::PrefixSpecial(_)
                | Self::PrefixDigits(_)
                | Self::PrefixName(_)
                | Self::PrefixBracket
                | Self::AfterBracket
                | Self::Op
        )
    }
}
