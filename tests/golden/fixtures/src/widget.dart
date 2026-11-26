class StatusBadge {
  final String label;
  final int count;

  const StatusBadge(this.label, this.count);

  String renderText() {
    return '$label ($count)';
  }
}
