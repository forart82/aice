enum SubmitPhase { idle, validating, submitting, submitted, failed }

class FormFieldState {
  final String name;
  String value;
  String? error;
  bool dirty;

  FormFieldState({required this.name, this.value = '', this.error, this.dirty = false});
}

class FormController {
  final Map<String, FormFieldState> _fields = {};
  SubmitPhase phase = SubmitPhase.idle;
  int _lastInputMs = 0;
  final int debounceMs;

  FormController({this.debounceMs = 250}) {
    _fields['email'] = FormFieldState(name: 'email');
    _fields['workspace'] = FormFieldState(name: 'workspace');
    _fields['quota'] = FormFieldState(name: 'quota', value: '100');
  }

  void updateField(String name, String value, int nowMs) {
    final field = _fields[name];
    if (field == null) {
      return;
    }
    field.value = value.trim();
    field.dirty = true;
    _lastInputMs = nowMs;
    field.error = _validateField(name, field.value);
    if (phase == SubmitPhase.failed || phase == SubmitPhase.submitted) {
      phase = SubmitPhase.idle;
    }
  }

  bool canSubmit(int nowMs) {
    if (phase == SubmitPhase.submitting) {
      return false;
    }
    if (nowMs - _lastInputMs < debounceMs) {
      return false;
    }
    return _fields.values.every((f) => _validateField(f.name, f.value) == null);
  }

  bool beginSubmit(int nowMs) {
    phase = SubmitPhase.validating;
    var hasError = false;
    for (final entry in _fields.entries) {
      final err = _validateField(entry.key, entry.value.value);
      entry.value.error = err;
      if (err != null) {
        hasError = true;
      }
    }
    if (hasError || nowMs - _lastInputMs < debounceMs) {
      phase = SubmitPhase.failed;
      return false;
    }
    phase = SubmitPhase.submitting;
    return true;
  }

  void completeSubmit(bool ok) {
    phase = ok ? SubmitPhase.submitted : SubmitPhase.failed;
  }

  String? _validateField(String name, String value) {
    if (value.isEmpty) {
      return '$name is required';
    }
    if (name == 'email' && !value.contains('@')) {
      return 'Invalid email address';
    }
    if (name == 'quota') {
      final parsed = int.tryParse(value);
      if (parsed == null || parsed < 1 || parsed > 10000) {
        return 'Quota must be 1..10000';
      }
    }
    return null;
  }
}
