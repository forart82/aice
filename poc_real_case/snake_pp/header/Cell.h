#pragma once

#include <SFML/Graphics.hpp>

class Cell
{

private:
  std::string m_key;
  int m_top;
  int m_left;
  int m_bottom;
  int m_right;
  sf::Vector2f m_position;
  sf::Color m_color;
  sf::Vertex *m_rect;

public:
  Cell(sf::Vertex *rect, sf::Vector2f position, sf::Color color);
  ~Cell();
  void update();

  void manageCell(sf::Vertex *rect, sf::Vector2f position);

  // MARK: Setter
  void setPosition(sf::Vector2f position);
  void setKey();
  void setTriangles(sf::Vertex *rect);
  void setRectColor();
  void setColor(sf::Color color);

  // MARK: Getter
  std::string getKey() const;
  sf::Color getColor();
  sf::Vector2f getPosition() const;
};
