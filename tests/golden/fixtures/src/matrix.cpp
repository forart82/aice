#include <vector>

namespace math {

class Matrix2 {
public:
    explicit Matrix2(double scale) : scale_(scale) {}

    double trace() const {
        return scale_ * 2.0;
    }

private:
    double scale_;
};

} // namespace math
