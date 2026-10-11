// Represents a system user entity with profile information.
// data class
data class UserEntity(
    val id: String,
    val name: String,
    val email: String,
    val age: Int = 18,
    val isActive: Boolean = true,
    val bio: String? = null
) {
    fun getDisplayName(): String {
        "$name <$email>"
    }

    fun isAdult(): Boolean {
        age >= 18
    }
}
