#pragma once

#include <SFML/Graphics.hpp>
#include "Snake.h"

class Lost
{
private:
  sf::Font m_font;
  sf::Text m_lostText;

  bool m_isActive;
  bool m_isFontLoaded;

public:
  Lost();
  ~Lost();

  void update(Snake &snake);
  void draw(sf::RenderTarget &target);

  void setIsActive(bool isActive);
};
