#pragma once

#include <SFML/Graphics.hpp>

class DebugBar
{

private:
  sf::Font m_font;
  sf::Text m_text;

  bool m_isFontLoaded;
  bool m_isActive;

public:
  DebugBar();
  ~DebugBar();

  void update(sf::Time timePerFrame, sf::Time timeSinceLastUpdate);
  void draw(sf::RenderWindow &window);

  void switchActive();
};