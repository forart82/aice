#pragma once

#include <SFML/Graphics/Color.hpp>
#include <SFML/Graphics/PrimitiveType.hpp>
#include <SFML/Graphics/Rect.hpp>
#include <SFML/Graphics/RenderStates.hpp>
#include <SFML/Graphics/RenderTarget.hpp>
#include <SFML/Graphics/VertexArray.hpp>
#include <SFML/System/Vector2.hpp>

#include <cstddef>

namespace dof::render::ui {

class QuadBatch {
public:
    QuadBatch() : vertices(sf::PrimitiveType::Triangles) {}

    void clear() { vertices.clear(); }
    bool empty() const { return vertices.getVertexCount() == 0; }
    std::size_t vertexCount() const { return vertices.getVertexCount(); }

    void addQuad(sf::Vector2f topLeft,
                 sf::Vector2f topRight,
                 sf::Vector2f bottomRight,
                 sf::Vector2f bottomLeft,
                 sf::Color color) {
        const std::size_t base = vertices.getVertexCount();
        vertices.resize(base + 6);
        vertices[base + 0].position = topLeft;
        vertices[base + 1].position = topRight;
        vertices[base + 2].position = bottomRight;
        vertices[base + 3].position = topLeft;
        vertices[base + 4].position = bottomRight;
        vertices[base + 5].position = bottomLeft;
        for (std::size_t i = base; i < base + 6; ++i) {
            vertices[i].color = color;
        }
    }

    void addTriangle(sf::Vector2f a, sf::Vector2f b, sf::Vector2f c, sf::Color color) {
        const std::size_t base = vertices.getVertexCount();
        vertices.resize(base + 3);
        vertices[base + 0].position = a;
        vertices[base + 1].position = b;
        vertices[base + 2].position = c;
        for (std::size_t i = base; i < base + 3; ++i) {
            vertices[i].color = color;
        }
    }

    void addRect(sf::FloatRect rect, sf::Color color) {
        addQuad(rect.position,
                {rect.position.x + rect.size.x, rect.position.y},
                {rect.position.x + rect.size.x, rect.position.y + rect.size.y},
                {rect.position.x, rect.position.y + rect.size.y},
                color);
    }

    void flush(sf::RenderTarget& target,
               const sf::RenderStates& states = sf::RenderStates::Default) {
        if (empty()) return;
        target.draw(vertices, states);
        clear();
    }

private:
    sf::VertexArray vertices;
};

}  // namespace dof::render::ui
